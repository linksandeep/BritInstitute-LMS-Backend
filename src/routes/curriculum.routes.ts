import { Router } from 'express';
import { adminOnly } from '../middleware/admin.middleware';
import { protect } from '../middleware/auth.middleware';
import {
  assignCurriculumToBatch,
  getBatchCurriculum,
  getDefaultCurriculums,
  getMyCurriculum,
  updateBatchCurriculum,
} from '../controllers/curriculum.controller';

const router = Router();

router.use(protect);

router.get('/me', getMyCurriculum);
router.get('/batch/:batchId', getBatchCurriculum);
router.get('/defaults', adminOnly, getDefaultCurriculums);
router.put('/batch/:batchId', adminOnly, updateBatchCurriculum);
router.put('/batch/:batchId/assign-template', adminOnly, assignCurriculumToBatch);

export default router;
