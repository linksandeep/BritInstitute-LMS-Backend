import { NextFunction, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { AuthRequest } from './auth.middleware';

export const projectUploadDir = path.resolve(__dirname, '..', '..', 'uploads', 'projects');
fs.mkdirSync(projectUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: projectUploadDir,
  filename: (_req, file, cb) => {
    const safeBase = path.basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'project';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeBase}.zip`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const isZip = path.extname(file.originalname).toLowerCase() === '.zip'
      && ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(file.mimetype);
    if (!isZip) {
      cb(new Error('Only ZIP files are allowed'));
      return;
    }
    cb(null, true);
  },
});

export const uploadProjectZip = (req: AuthRequest, res: Response, next: NextFunction): void => {
  upload.single('projectFile')(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    const message = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
      ? 'ZIP file must be 50 MB or smaller'
      : error instanceof Error ? error.message : 'Project file upload failed';
    res.status(400).json({ success: false, message });
  });
};
