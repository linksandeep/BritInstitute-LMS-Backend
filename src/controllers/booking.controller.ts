import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { Booking } from '../models/Booking.model';
import { User } from '../models/User.model';

// Fetch available mentors (admins)
export const getMentors = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const mentors = await User.find({ role: 'teacher', isActive: true }).select('name username');
    res.json({ success: true, mentors });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

// Student creates a booking request
export const createBooking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { mentor, topic, dateTime } = req.body;
    const student = req.user!.id;

    if (!mentor || !topic || !dateTime) {
      res.status(400).json({ success: false, message: 'Mentor, topic and date-time are required' });
      return;
    }

    const booking = await Booking.create({
      student,
      mentor,
      topic,
      dateTime,
      status: 'pending'
    });

    res.status(201).json({ success: true, booking });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

// Fetch bookings for the logged-in student
export const getMyBookings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const student = req.user!.id;
    const bookings = await Booking.find({ student })
      .populate('mentor', 'name username')
      .sort({ dateTime: 1 });
    
    res.json({ success: true, bookings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

// Cancel a booking
export const cancelBooking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const student = req.user!.id;

    const booking = await Booking.findOne({ _id: id, student });
    if (!booking) {
      res.status(404).json({ success: false, message: 'Booking not found' });
      return;
    }

    if (booking.status === 'completed') {
      res.status(400).json({ success: false, message: 'Cannot cancel a completed session' });
      return;
    }

    booking.status = 'cancelled';
    await booking.save();

    res.json({ success: true, message: 'Booking cancelled successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

// ─── Admin Controller Actions ────────────────────────────────────────────────

// Fetch all bookings (for admin view)
export const adminGetBookings = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookings = await Booking.find()
      .populate('student', 'name username')
      .populate('mentor', 'name username')
      .sort({ dateTime: -1 });
    
    res.json({ success: true, bookings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

// Update booking status and meeting link (admin)
export const adminUpdateBooking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, meetingLink } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) {
      res.status(404).json({ success: false, message: 'Booking not found' });
      return;
    }

    if (status) booking.status = status;
    if (meetingLink !== undefined) booking.meetingLink = meetingLink;

    await booking.save();
    res.json({ success: true, booking });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};
