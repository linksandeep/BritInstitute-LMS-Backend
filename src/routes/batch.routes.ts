import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import { adminOnly } from '../middleware/admin.middleware';
import {
  createBatch, getBatches, getBatch,
  updateBatch, deleteBatch,
  addStudentToBatch, removeStudentFromBatch,
} from '../controllers/batch.controller';

const router = Router();

// All batch routes require auth + admin role
router.use(protect, adminOnly);

router.get('/', getBatches);
router.post('/', createBatch);
router.get('/:id', getBatch);
router.put('/:id', updateBatch);
router.delete('/:id', deleteBatch);

// Student management within a batch
router.post('/:id/students', addStudentToBatch);
router.delete('/:id/students/:studentId', removeStudentFromBatch);

export default router;
