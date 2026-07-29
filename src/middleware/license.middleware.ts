import { Request, Response, NextFunction } from 'express';
import { checkSoftwareLicense, SoftwareLicenseError } from '../services/license.service';

export const requireSoftwareLicense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const status = await checkSoftwareLicense();

  if (status.allowed) {
    next();
    return;
  }

  res.status(423).json({
    success: false,
    message: status.message,
    license: {
      mode: status.mode,
      expiresAt: status.expiresAt,
    },
  });
};

export const sendLicenseError = (res: Response, error: unknown): boolean => {
  if (!(error instanceof SoftwareLicenseError)) return false;

  res.status(423).json({
    success: false,
    message: error.status.message,
    license: {
      mode: error.status.mode,
      expiresAt: error.status.expiresAt,
    },
  });
  return true;
};
