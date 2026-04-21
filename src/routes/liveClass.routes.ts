import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import { adminOnly } from '../middleware/admin.middleware';
import {
  createLiveClass, getLiveClassesByBatch, getStudentLiveClasses, getAllLiveClasses,
  updateLiveClass, deleteLiveClass, markAttend,
  getClassAttendance, getStudentAttendance,
} from '../controllers/liveClass.controller';

const router = Router();
router.use(protect);

// Get all live classes (admin)
router.get('/', adminOnly, getAllLiveClasses);

// Get my live classes (student)
router.get('/me', getStudentLiveClasses);

// Get by batch (admin)
router.get('/batch/:batchId', adminOnly, getLiveClassesByBatch);

// Admin CRUD
router.post('/', adminOnly, createLiveClass);
router.put('/:id', adminOnly, updateLiveClass);
router.delete('/:id', adminOnly, deleteLiveClass);

// Student joins (marks present)
router.post('/:id/attend', markAttend);

// Attendance
router.get('/attendance/class/:classId', adminOnly, getClassAttendance);
router.get('/attendance/student/:studentId', getStudentAttendance);
router.get('/attendance/me', getStudentAttendance);

export default router;
