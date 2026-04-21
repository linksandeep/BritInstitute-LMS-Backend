import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import { adminOnly } from '../middleware/admin.middleware';
import { 
  createRecordedLecture, 
  getAllLectures, 
  getLecturesByBatch, 
  getStudentLectures, 
  updateLecture, 
  deleteLecture,
  updateProgress
} from '../controllers/recorded.controller';

const router = Router();

// Student routes
router.get('/me', protect, getStudentLectures);
router.post('/:id/progress', protect, updateProgress);

// Admin routes
router.get('/', protect, adminOnly, getAllLectures);
router.get('/batch/:batchId', protect, adminOnly, getLecturesByBatch);
router.post('/', protect, adminOnly, createRecordedLecture);
router.put('/:id', protect, adminOnly, updateLecture);
router.delete('/:id', protect, adminOnly, deleteLecture);

export default router;
