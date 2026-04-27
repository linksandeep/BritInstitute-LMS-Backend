import { Response } from 'express';
import { User } from '../models/User.model';
import { Course } from '../models/Course.model';
import { Batch } from '../models/Batch.model';
import { AuthRequest } from '../middleware/auth.middleware';

// ─── Users ──────────────────────────────────────────────────────────────────

export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, username, password, enrolledCourse, phone, email } = req.body;
    if (!name || !username || !password) {
      res.status(400).json({ success: false, message: 'Name, username and password are required' });
      return;
    }
    const exists = await User.findOne({ username: username.toLowerCase() });
    if (exists) {
      res.status(409).json({ success: false, message: 'Username already taken' });
      return;
    }
    const normalizedEmail = email?.trim().toLowerCase();
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
      phone: phone?.trim() || '',
      email: normalizedEmail || '',
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
    res.status(500).json({ success: false, message: 'Server error', error: err });
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
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, username, password, enrolledCourse, isActive, phone, email } = req.body;
    const user = await User.findById(id).select('+password');
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    if (name) user.name = name;
    if (username && username.toLowerCase() !== user.username) {
      const existingUsername = await User.findOne({ username: username.toLowerCase(), _id: { $ne: id } });
      if (existingUsername) {
        res.status(409).json({ success: false, message: 'Username already taken' });
        return;
      }
      user.username = username.toLowerCase();
    }
    if (email !== undefined) {
      const normalizedEmail = email.trim().toLowerCase();
      if (normalizedEmail) {
        const existingEmail = await User.findOne({ email: normalizedEmail, _id: { $ne: id } });
        if (existingEmail) {
          res.status(409).json({ success: false, message: 'Email already taken' });
          return;
        }
      }
      user.email = normalizedEmail;
    }
    if (phone !== undefined) user.phone = phone.trim();
    if (enrolledCourse !== undefined) user.enrolledCourse = enrolledCourse || undefined;
    if (isActive !== undefined) user.isActive = isActive;
    if (password) user.password = password; // will be hashed by pre-save hook
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
    res.status(500).json({ success: false, message: 'Server error', error: err });
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
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

// ─── Courses ─────────────────────────────────────────────────────────────────

export const createCourse = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, description } = req.body;
    if (!title || !description) {
      res.status(400).json({ success: false, message: 'Title and description are required' });
      return;
    }
    const course = await Course.create({ title, description, createdBy: req.user!.id });
    res.status(201).json({ success: true, course });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getCourses = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });
    res.json({ success: true, courses });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const updateCourse = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const course = await Course.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!course) {
      res.status(404).json({ success: false, message: 'Course not found' });
      return;
    }
    res.json({ success: true, course });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const deleteCourse = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const course = await Course.findByIdAndDelete(req.params.id);
    if (!course) {
      res.status(404).json({ success: false, message: 'Course not found' });
      return;
    }
    res.json({ success: true, message: 'Course deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
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
