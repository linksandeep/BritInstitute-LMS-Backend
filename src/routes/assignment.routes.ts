import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import { adminOnly } from '../middleware/admin.middleware';
import {
  createAssignment, getAssignmentsByBatch, getStudentAssignments, getAllAssignments,
  updateAssignment, deleteAssignment, submitAssignment, getAssignmentSubmissions,
} from '../controllers/assignment.controller';

const router = Router();
router.use(protect);

router.get('/', adminOnly, getAllAssignments);
router.get('/me', getStudentAssignments);
router.get('/batch/:batchId', adminOnly, getAssignmentsByBatch);
router.get('/:id/submissions', adminOnly, getAssignmentSubmissions);

router.post('/', adminOnly, createAssignment);
router.post('/:id/submit', submitAssignment);
router.put('/:id', adminOnly, updateAssignment);
router.delete('/:id', adminOnly, deleteAssignment);

export default router;
