import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import { adminOnly } from '../middleware/admin.middleware';
import {
  createUser, getUsers, updateUser, deleteUser,
  createCourse, getCourses, updateCourse, deleteCourse,
  getStats,
} from '../controllers/admin.controller';

const router = Router();

// All admin routes require auth + admin role
router.use(protect, adminOnly);

// Stats
router.get('/stats', getStats);

// Users
router.post('/users', createUser);
router.get('/users', getUsers);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

// Courses
router.post('/courses', createCourse);
router.get('/courses', getCourses);
router.put('/courses/:id', updateCourse);
router.delete('/courses/:id', deleteCourse);

export default router;
