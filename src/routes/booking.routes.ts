import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.middleware';
import { 
  getMentors, 
  createBooking, 
  getMyBookings, 
  cancelBooking,
  adminGetBookings,
  adminUpdateBooking
} from '../controllers/booking.controller';

const router = Router();

// All routes require authentication
router.use(protect);

// Student routes
router.get('/mentors', getMentors);
router.post('/', createBooking);
router.get('/me', getMyBookings);
router.patch('/:id/cancel', cancelBooking);

// Admin routes
router.get('/admin', authorize(['teacher', 'superadmin']), adminGetBookings);
router.patch('/admin/:id', authorize(['teacher', 'superadmin']), adminUpdateBooking);

export default router;
