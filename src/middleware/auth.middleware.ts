import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.model';
import { assertSoftwareLicense, getLicenseBoundJwtSecret } from '../services/license.service';
import { sendLicenseError } from './license.middleware';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    username: string;
    sessionId?: string;
  };
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await assertSoftwareLicense();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, message: 'Not authorized, no token' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, getLicenseBoundJwtSecret()) as { id: string; role: string; username: string; sessionId?: string };

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: 'User not found or inactive' });
      return;
    }

    req.user = { id: decoded.id, role: decoded.role, username: decoded.username, sessionId: decoded.sessionId };
    next();
  } catch (err) {
    if (sendLicenseError(res, err)) return;
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

export const authorize = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
      return;
    }
    next();
  };
};
