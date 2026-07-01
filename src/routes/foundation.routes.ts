import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import { adminOnly } from '../middleware/admin.middleware';
import {
  createFoundationResource,
  deleteFoundationResource,
  getFoundationResources,
  updateFoundationResource,
} from '../controllers/foundation.controller';

const router = Router();

router.get('/', protect, getFoundationResources);
router.post('/', protect, adminOnly, createFoundationResource);
router.put('/:id', protect, adminOnly, updateFoundationResource);
router.delete('/:id', protect, adminOnly, deleteFoundationResource);

export default router;
