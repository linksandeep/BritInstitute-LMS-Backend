import { Response } from 'express';
import { User } from '../models/User.model';
import { Course } from '../models/Course.model';
import { Batch } from '../models/Batch.model';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  getErrorMessage,
  getDuplicateKeyMessage,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeUsername,
  validateEmail,
  validatePassword,
  validatePhone,
  validateUsername,
} from '../utils/validation';

// ─── Users ──────────────────────────────────────────────────────────────────

export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const name = normalizeName(req.body.name);
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || '');
    const enrolledCourse = req.body.enrolledCourse;
    const normalizedPhone = normalizePhone(req.body.phone);
    const normalizedEmail = normalizeEmail(req.body.email);

    if (!name || !username || !password) {
      res.status(400).json({ success: false, message: 'Name, username and password are required' });
      return;
    }
    const usernameError = validateUsername(username);
    if (usernameError) {
      res.status(400).json({ success: false, message: usernameError });
      return;
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      res.status(400).json({ success: false, message: passwordError });
      return;
    }
    const emailError = validateEmail(normalizedEmail);
    if (emailError) {
      res.status(400).json({ success: false, message: emailError });
      return;
    }
    const phoneError = validatePhone(normalizedPhone);
    if (phoneError) {
      res.status(400).json({ success: false, message: phoneError });
      return;
    }

    const exists = await User.findOne({ username });
    if (exists) {
      res.status(409).json({ success: false, message: 'Username already taken' });
      return;
    }
    if (normalizedEmail) {
      const existingEmail = await User.findOne({ email: normalizedEmail });
      if (existingEmail) {
        res.status(409).json({ success: false, message: 'Email already taken' });
        return;
      }
    }

    const user = await User.create({
      name,
      username,
      password,
      role: 'student',
      enrolledCourse: enrolledCourse || undefined,
      phone: normalizedPhone,
      email: normalizedEmail || undefined,
    });
    res.status(201).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        enrolledCourse: user.enrolledCourse,
        phone: user.phone,
        email: user.email,
      }
    });
  } catch (err) {
    const duplicateMessage = getDuplicateKeyMessage(err);
    res.status(duplicateMessage ? 409 : 500).json({ success: false, message: duplicateMessage || getErrorMessage(err) });
  }
};

export const getUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const query: Record<string, unknown> = { role: 'student' };

    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { name: searchRegex },
        { username: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
      ];
    }

    const users = await User.find(query).populate('enrolledCourse', 'title').sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: getErrorMessage(err) });
  }
};

export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { password, enrolledCourse, isActive } = req.body;
    const name = req.body.name !== undefined ? normalizeName(req.body.name) : undefined;
    const username = req.body.username !== undefined ? normalizeUsername(req.body.username) : undefined;
    const normalizedPhone = req.body.phone !== undefined ? normalizePhone(req.body.phone) : undefined;
    const normalizedEmail = req.body.email !== undefined ? normalizeEmail(req.body.email) : undefined;
    const user = await User.findById(id).select('+password');
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    if (name !== undefined) {
      if (!name) {
        res.status(400).json({ success: false, message: 'Name is required' });
        return;
      }
      user.name = name;
    }
    if (username && username.toLowerCase() !== user.username) {
      const usernameError = validateUsername(username);
      if (usernameError) {
        res.status(400).json({ success: false, message: usernameError });
        return;
      }
      const existingUsername = await User.findOne({ username, _id: { $ne: id } });
      if (existingUsername) {
        res.status(409).json({ success: false, message: 'Username already taken' });
        return;
      }
      user.username = username;
    }
    if (req.body.email !== undefined) {
      if (normalizedEmail) {
        const emailError = validateEmail(normalizedEmail);
        if (emailError) {
          res.status(400).json({ success: false, message: emailError });
          return;
        }
        const existingEmail = await User.findOne({ email: normalizedEmail, _id: { $ne: id } });
        if (existingEmail) {
          res.status(409).json({ success: false, message: 'Email already taken' });
          return;
        }
      }
      user.email = normalizedEmail || undefined;
    }
    if (req.body.phone !== undefined) {
      const phoneError = validatePhone(normalizedPhone || '');
      if (phoneError) {
        res.status(400).json({ success: false, message: phoneError });
        return;
      }
      user.phone = normalizedPhone || '';
    }
    if (enrolledCourse !== undefined) user.enrolledCourse = enrolledCourse || undefined;
    if (isActive !== undefined) user.isActive = isActive;
    if (password) {
      const passwordError = validatePassword(String(password));
      if (passwordError) {
        res.status(400).json({ success: false, message: passwordError });
        return;
      }
      user.password = String(password); // will be hashed by pre-save hook
    }
    await user.save();
    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        enrolledCourse: user.enrolledCourse,
        isActive: user.isActive,
        phone: user.phone,
        email: user.email,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: getErrorMessage(err) });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = await User.findByIdAndDelete(id);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    const duplicateMessage = getDuplicateKeyMessage(err);
    res.status(duplicateMessage ? 409 : 500).json({ success: false, message: duplicateMessage || getErrorMessage(err) });
  }
};

export const getTeachersForCourseAccess = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teachers = await User.find({ role: 'teacher', isActive: true })
      .select('name username role isActive')
      .sort({ name: 1 });
    res.json({ success: true, teachers });
  } catch (err) {
    res.status(500).json({ success: false, message: getErrorMessage(err) });
  }
};

// ─── Courses ─────────────────────────────────────────────────────────────────

const isAdminRole = (role?: string) => role === 'admin' || role === 'superadmin';

const getCourseQueryForUser = (user: AuthRequest['user']) => {
  if (isAdminRole(user?.role)) return {};
  return {
    $or: [
      { createdBy: user!.id },
      { isPublic: true },
      { assignedTeachers: user!.id },
    ],
  };
};

const serializeCourse = (course: any, user: AuthRequest['user']) => {
  const object = typeof course.toObject === 'function' ? course.toObject() : course;
  const createdById = String(object.createdBy?._id || object.createdBy || '');
  const canManage = isAdminRole(user?.role) || createdById === user?.id;

  return {
    ...object,
    canManage,
  };
};

const getCourseAccessPayload = (req: AuthRequest) => {
  const isPublic = req.body.isPublic === true;
  const assignedTeachers = Array.isArray(req.body.assignedTeachers)
    ? req.body.assignedTeachers.filter(Boolean)
    : req.body.assignedTeacher
      ? [req.body.assignedTeacher]
      : [];

  if (!isAdminRole(req.user?.role)) {
    return { isPublic: false, assignedTeachers: [] };
  }

  return {
    isPublic,
    assignedTeachers: isPublic ? [] : assignedTeachers,
  };
};

export const createCourse = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, description } = req.body;
    if (!title || !description) {
      res.status(400).json({ success: false, message: 'Title and description are required' });
      return;
    }
    const access = getCourseAccessPayload(req);
    const course = await Course.create({
      title: String(title).trim(),
      description: String(description).trim(),
      createdBy: req.user!.id,
      ...access,
    });
    const populatedCourse = await Course.findById(course._id)
      .populate('createdBy', 'name username role')
      .populate('assignedTeachers', 'name username role');
    res.status(201).json({ success: true, course: serializeCourse(populatedCourse, req.user) });
  } catch (err) {
    res.status(500).json({ success: false, message: getErrorMessage(err) });
  }
};

export const getCourses = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const courses = await Course.find(getCourseQueryForUser(req.user))
      .populate('createdBy', 'name username role')
      .populate('assignedTeachers', 'name username role')
      .sort({ createdAt: -1 });
    res.json({ success: true, courses: courses.map((course) => serializeCourse(course, req.user)) });
  } catch (err) {
    res.status(500).json({ success: false, message: getErrorMessage(err) });
  }
};

export const updateCourse = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const course = await Course.findOne({ _id: req.params.id, ...getCourseQueryForUser(req.user) });
    if (!course) {
      res.status(404).json({ success: false, message: 'Course not found' });
      return;
    }

    const createdById = String(course.createdBy);
    if (!isAdminRole(req.user?.role) && createdById !== req.user?.id) {
      res.status(403).json({ success: false, message: 'You can only edit courses you created' });
      return;
    }

    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    if (!title || !description) {
      res.status(400).json({ success: false, message: 'Title and description are required' });
      return;
    }

    course.title = title;
    course.description = description;

    if (isAdminRole(req.user?.role)) {
      const access = getCourseAccessPayload(req);
      course.isPublic = access.isPublic;
      course.assignedTeachers = access.assignedTeachers as any;
    }

    await course.save();
    const populatedCourse = await Course.findById(course._id)
      .populate('createdBy', 'name username role')
      .populate('assignedTeachers', 'name username role');
    res.json({ success: true, course: serializeCourse(populatedCourse, req.user) });
  } catch (err) {
    res.status(500).json({ success: false, message: getErrorMessage(err) });
  }
};

export const deleteCourse = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const course = await Course.findOne({ _id: req.params.id, ...getCourseQueryForUser(req.user) });
    if (!course) {
      res.status(404).json({ success: false, message: 'Course not found' });
      return;
    }

    const createdById = String(course.createdBy);
    if (!isAdminRole(req.user?.role) && createdById !== req.user?.id) {
      res.status(403).json({ success: false, message: 'You can only delete courses you created' });
      return;
    }

    await course.deleteOne();
    res.json({ success: true, message: 'Course deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: getErrorMessage(err) });
  }
};

// ─── Stats ────────────────────────────────────────────────────────────────────

export const getStats = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [totalStudents, totalCourses, totalBatches] = await Promise.all([
      User.countDocuments({ role: 'student' }),
      Course.countDocuments(),
      Batch.countDocuments(),
    ]);
    res.json({ success: true, stats: { totalStudents, totalCourses, totalBatches } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};
