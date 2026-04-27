import { Response } from 'express';
import { User } from '../models/User.model';
import { AuthRequest } from '../middleware/auth.middleware';

export const createTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, username, password } = req.body;
    if (!name || !username || !password) {
      res.status(400).json({ success: false, message: 'Name, username and password are required' });
      return;
    }

    const existingUser = await User.findOne({ username: username.toLowerCase() });
    if (existingUser) {
      res.status(409).json({ success: false, message: 'Username already taken' });
      return;
    }

    const teacher = await User.create({
      name,
      username,
      password,
      role: 'teacher',
      isActive: true,
    });

    res.status(201).json({
      success: true,
      teacher: {
        id: teacher._id,
        name: teacher.name,
        username: teacher.username,
        role: teacher.role,
        isActive: teacher.isActive,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getTeachers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teachers = await User.find({ role: 'teacher' }).sort({ createdAt: -1 });
    res.json({ success: true, teachers });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const updateTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, username, password, isActive } = req.body;
    const teacher = await User.findOne({ _id: id, role: 'teacher' }).select('+password');

    if (!teacher) {
      res.status(404).json({ success: false, message: 'Teacher not found' });
      return;
    }

    if (name) teacher.name = name;
    if (username) teacher.username = username.toLowerCase();
    if (isActive !== undefined) teacher.isActive = isActive;
    if (password) teacher.password = password;
    await teacher.save();

    res.json({
      success: true,
      teacher: {
        id: teacher._id,
        name: teacher.name,
        username: teacher.username,
        role: teacher.role,
        isActive: teacher.isActive,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const deleteTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teacher = await User.findOneAndDelete({ _id: req.params.id, role: 'teacher' });
    if (!teacher) {
      res.status(404).json({ success: false, message: 'Teacher not found' });
      return;
    }

    res.json({ success: true, message: 'Teacher deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getSuperAdminStats = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [totalTeachers, activeTeachers, totalStudents, totalAdmins] = await Promise.all([
      User.countDocuments({ role: 'teacher' }),
      User.countDocuments({ role: 'teacher', isActive: true }),
      User.countDocuments({ role: 'student' }),
      User.countDocuments({ role: 'admin', isActive: true }),
    ]);

    res.json({ success: true, stats: { totalTeachers, activeTeachers, totalStudents, totalAdmins } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};
