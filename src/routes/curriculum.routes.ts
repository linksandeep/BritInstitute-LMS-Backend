import { Router } from 'express';
import { adminOnly } from '../middleware/admin.middleware';
import { protect } from '../middleware/auth.middleware';
import {
  assignCurriculumToBatch,
  archiveDefaultCurriculum,
  createDefaultCurriculum,
  deleteDefaultCurriculum,
  duplicateDefaultCurriculum,
  getBatchCurriculum,
  getDefaultCurriculums,
  getMyCurriculum,
  updateDefaultCurriculum,
  updateBatchCurriculum,
} from '../controllers/curriculum.controller';

const router = Router();

router.use(protect);

router.get('/me', getMyCurriculum);
router.get('/batch/:batchId', getBatchCurriculum);
router.get('/defaults', adminOnly, getDefaultCurriculums);
router.post('/defaults', adminOnly, createDefaultCurriculum);
router.put('/defaults/:curriculumId', adminOnly, updateDefaultCurriculum);
router.post('/defaults/:curriculumId/duplicate', adminOnly, duplicateDefaultCurriculum);
router.patch('/defaults/:curriculumId/archive', adminOnly, archiveDefaultCurriculum);
router.delete('/defaults/:curriculumId', adminOnly, deleteDefaultCurriculum);
router.put('/batch/:batchId', adminOnly, updateBatchCurriculum);
router.put('/batch/:batchId/assign-template', adminOnly, assignCurriculumToBatch);

export default router;
