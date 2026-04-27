import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import { superAdminOnly } from '../middleware/admin.middleware';
import {
  createTeacher,
  deleteTeacher,
  getSuperAdminStats,
  getTeachers,
  updateTeacher,
} from '../controllers/superadmin.controller';

const router = Router();

router.use(protect, superAdminOnly);

router.get('/stats', getSuperAdminStats);
router.get('/teachers', getTeachers);
router.post('/teachers', createTeacher);
router.put('/teachers/:id', updateTeacher);
router.delete('/teachers/:id', deleteTeacher);

export default router;
