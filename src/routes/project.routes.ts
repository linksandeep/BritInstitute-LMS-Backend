import { Router } from 'express';
import {
  createProject,
  deleteProject,
  downloadProject,
  getProjects,
  updateProject,
} from '../controllers/project.controller';
import { adminOnly } from '../middleware/admin.middleware';
import { protect } from '../middleware/auth.middleware';
import { uploadProjectZip } from '../middleware/projectUpload.middleware';

const router = Router();

router.get('/', protect, getProjects);
router.get('/:id/download', protect, downloadProject);
router.post('/', protect, adminOnly, uploadProjectZip, createProject);
router.put('/:id', protect, adminOnly, uploadProjectZip, updateProject);
router.delete('/:id', protect, adminOnly, deleteProject);

export default router;
