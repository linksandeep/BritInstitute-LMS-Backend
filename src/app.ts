import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config/env';
import { connectDB } from './config/db';
import authRoutes from './routes/auth.routes';
import adminRoutes from './routes/admin.routes';
import liveClassRoutes from './routes/liveClass.routes';
import recordedRoutes from './routes/recorded.routes';
import assignmentRoutes from './routes/assignment.routes';
import batchRoutes from './routes/batch.routes';
import bookingRoutes from './routes/booking.routes';
import curriculumRoutes from './routes/curriculum.routes';
import superAdminRoutes from './routes/superadmin.routes';
import { startAttendanceJob } from './jobs/attendance.job';

const app: Application = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
if (config.nodeEnv === 'development') {
  app.use(morgan('dev'));
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Brit Institute LMS API', version: '1.0.0' });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/live-classes', liveClassRoutes);
app.use('/api/recorded', recordedRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/admin/batches', batchRoutes);
app.use('/api/sessions', bookingRoutes);
app.use('/api/curriculums', curriculumRoutes);
app.use('/api/superadmin', superAdminRoutes);

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const start = async (): Promise<void> => {
  await connectDB();
  startAttendanceJob();
  app.listen(config.port, () => {
    console.log(`🚀 Server running on http://localhost:${config.port}`);
    console.log(`🌍 Environment: ${config.nodeEnv}`);
  });
};

start().catch((err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});
