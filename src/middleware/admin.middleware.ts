import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';

export const adminOnly = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user || !['teacher', 'admin', 'superadmin'].includes(req.user.role)) {
    res.status(403).json({ success: false, message: 'Access denied. Staff only.' });
    return;
  }
  next();
};

export const superAdminOnly = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user?.role !== 'superadmin') {
    res.status(403).json({ success: false, message: 'Access denied. Super admins only.' });
    return;
  }
  next();
};
