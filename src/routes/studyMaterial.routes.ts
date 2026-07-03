import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import { adminOnly } from '../middleware/admin.middleware';
import {
  createStudyMaterial,
  deleteStudyMaterial,
  getStudyMaterials,
  updateStudyMaterial,
} from '../controllers/studyMaterial.controller';

const router = Router();

router.get('/', protect, getStudyMaterials);
router.post('/', protect, adminOnly, createStudyMaterial);
router.put('/:id', protect, adminOnly, updateStudyMaterial);
router.delete('/:id', protect, adminOnly, deleteStudyMaterial);

export default router;
