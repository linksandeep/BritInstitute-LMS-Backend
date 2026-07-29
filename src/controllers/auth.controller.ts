import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.model';
import { UserSession } from '../models/UserSession.model';
import { config } from '../config/env';
import { getErrorMessage, normalizeUsername, validatePassword } from '../utils/validation';
import { assertSoftwareLicense, getLicenseBoundJwtSecret } from '../services/license.service';
import { sendLicenseError } from '../middleware/license.middleware';

const getSessionDurationSeconds = (loginAt: Date, endAt = new Date()) =>
  Math.max(0, Math.floor((endAt.getTime() - loginAt.getTime()) / 1000));

const getInactivityTimeoutMinutes = () => {
  const minutes = Number(config.inactivityTimeoutMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
};

const signToken = (id: string, role: string, username: string, sessionId: string): string => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign({ id, role, username, sessionId }, getLicenseBoundJwtSecret() as any, {
    expiresIn: config.jwtExpiresIn as any,
  });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    await assertSoftwareLicense();

    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || '');

    if (!username || !password) {
      res.status(400).json({ success: false, message: 'Username and password are required' });
      return;
    }

    const user = await User.findOne({ username }).select('+password');
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }

    const now = new Date();
    const session = await UserSession.create({
      user: user._id,
      role: user.role,
      loginAt: now,
      lastActiveAt: now,
      userAgent: req.get('user-agent') || '',
      ipAddress: req.ip,
    });
    const token = signToken(String(user._id), user.role, user.username, String(session._id));

    res.json({
      success: true,
      token,
      sessionId: session._id,
      inactivityTimeoutMinutes: getInactivityTimeoutMinutes(),
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        role: user.role,
        enrolledCourse: user.enrolledCourse,
      },
    });
  } catch (err) {
    if (sendLicenseError(res, err)) return;
    res.status(500).json({ success: false, message: getErrorMessage(err) });
  }
};

export const getSessionConfig = (_req: Request, res: Response): void => {
  res.json({ success: true, inactivityTimeoutMinutes: getInactivityTimeoutMinutes() });
};

export const heartbeat = async (req: Request & { user?: { id: string; sessionId?: string } }, res: Response): Promise<void> => {
  try {
    const sessionId = req.user?.sessionId || req.body.sessionId;
    if (!sessionId) {
      res.status(400).json({ success: false, message: 'sessionId is required' });
      return;
    }

    const now = new Date();
    const session = await UserSession.findOne({ _id: sessionId, user: req.user?.id, status: 'active' });
    if (!session) {
      res.status(404).json({ success: false, message: 'Active session not found' });
      return;
    }

    session.lastActiveAt = now;
    session.durationSeconds = getSessionDurationSeconds(session.loginAt, now);
    await session.save();

    res.json({ success: true, lastActiveAt: session.lastActiveAt, durationSeconds: session.durationSeconds });
  } catch (err) {
    res.status(500).json({ success: false, message: getErrorMessage(err) });
  }
};

export const logoutSession = async (req: Request & { user?: { id: string; sessionId?: string } }, res: Response): Promise<void> => {
  try {
    const sessionId = req.user?.sessionId || req.body.sessionId;
    const reason = req.body.reason === 'inactivity' ? 'inactivity' : 'manual';
    if (sessionId) {
      const now = new Date();
      const session = await UserSession.findOne({ _id: sessionId, user: req.user?.id, status: 'active' });
      if (session) {
        session.logoutAt = now;
        session.lastActiveAt = now;
        session.durationSeconds = getSessionDurationSeconds(session.loginAt, now);
        session.status = reason === 'inactivity' ? 'expired' : 'logged_out';
        session.logoutReason = reason;
        await session.save();
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: getErrorMessage(err) });
  }
};

export const getMe = async (req: Request & { user?: { id: string } }, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?.id).populate('enrolledCourse', 'title description');
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: getErrorMessage(err) });
  }
};

export const changePassword = async (req: Request & { user?: { id: string } }, res: Response): Promise<void> => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    const confirmPassword = String(req.body.confirmPassword || '');

    if (!currentPassword || !newPassword || !confirmPassword) {
      res.status(400).json({ success: false, message: 'Current password, new password and confirmation are required' });
      return;
    }

    if (newPassword !== confirmPassword) {
      res.status(400).json({ success: false, message: 'New password and confirmation do not match' });
      return;
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      res.status(400).json({ success: false, message: passwordError });
      return;
    }

    const user = await User.findById(req.user?.id).select('+password');
    if (!user || !user.isActive) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      res.status(401).json({ success: false, message: 'Current password is incorrect' });
      return;
    }

    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      res.status(400).json({ success: false, message: 'New password must be different from the current password' });
      return;
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: getErrorMessage(err) });
  }
};
