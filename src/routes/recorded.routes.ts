import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import { adminOnly } from '../middleware/admin.middleware';
import {
  createRecordedLecture, getLecturesByBatch, getStudentLectures, getAllLectures,
  updateLecture, deleteLecture,
} from '../controllers/recorded.controller';

const router = Router();
router.use(protect);

router.get('/', adminOnly, getAllLectures);
router.get('/me', getStudentLectures);
router.get('/batch/:batchId', adminOnly, getLecturesByBatch);

router.post('/', adminOnly, createRecordedLecture);
router.put('/:id', adminOnly, updateLecture);
router.delete('/:id', adminOnly, deleteLecture);

export default router;
