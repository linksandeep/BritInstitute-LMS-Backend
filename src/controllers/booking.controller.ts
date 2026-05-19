import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { Booking } from '../models/Booking.model';
import { User } from '../models/User.model';
import { createZoomMeeting, deleteZoomMeeting, updateZoomMeeting, ZoomApiError } from '../services/zoom.service';

const sendBookingError = (res: Response, err: unknown, fallback: string): void => {
  if (err instanceof ZoomApiError) {
    res.status(502).json({ success: false, message: err.message });
    return;
  }

  res.status(500).json({ success: false, message: fallback });
};

const getErrorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error) return err.message;
  return fallback;
};

const populateBooking = (id: string) =>
  Booking.findById(id)
    .populate('student', 'name username')
    .populate('mentor', 'name username');

// Fetch available mentors (admins)
export const getMentors = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const mentors = await User.find({ role: 'teacher', isActive: true }).select('name username');
    res.json({ success: true, mentors });
  } catch (err) {
    sendBookingError(res, err, 'Unable to load mentors. Please try again.');
  }
};

// Student creates a booking request
export const createBooking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { mentor, topic, dateTime } = req.body;
    const duration = Number(req.body.duration) || 30;
    const student = req.user!.id;

    if (!mentor || !topic || !dateTime) {
      res.status(400).json({ success: false, message: 'Mentor, topic and date-time are required' });
      return;
    }

    const startTime = new Date(dateTime);
    if (Number.isNaN(startTime.getTime())) {
      res.status(400).json({ success: false, message: 'Invalid session date-time' });
      return;
    }

    const mentorExists = await User.findOne({ _id: mentor, role: { $in: ['teacher', 'admin', 'superadmin'] }, isActive: true });
    if (!mentorExists) {
      res.status(404).json({ success: false, message: 'Teacher or admin not found' });
      return;
    }

    const booking = await Booking.create({
      student,
      mentor,
      topic: String(topic).trim(),
      dateTime: startTime,
      duration,
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
      .select('-zoomStartUrl')
      .populate('mentor', 'name username')
      .sort({ dateTime: 1 });
    
    res.json({ success: true, bookings });
  } catch (err) {
    sendBookingError(res, err, 'Unable to load appointments. Please try again.');
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

    let warning: string | undefined;
    if (booking.zoomMeetingId) {
      try {
        await deleteZoomMeeting(booking.zoomMeetingId);
        booking.zoomMeetingId = undefined;
        booking.zoomStartUrl = undefined;
        booking.meetingLink = undefined;
      } catch (err) {
        warning = getErrorMessage(err, 'The Zoom meeting could not be deleted.');
        console.warn(`Zoom cleanup failed for booking ${booking._id}: ${warning}`);
      }
    }

    booking.status = 'cancelled';
    await booking.save();

    res.json({ success: true, message: warning ? 'Booking cancelled. Zoom cleanup needs attention.' : 'Booking cancelled successfully', warning });
  } catch (err) {
    sendBookingError(res, err, 'Unable to cancel appointment. Please try again.');
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
    sendBookingError(res, err, 'Unable to load appointments. Please try again.');
  }
};

// Update booking status and Zoom meeting details (admin/teacher)
export const adminUpdateBooking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, meetingLink } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) {
      res.status(404).json({ success: false, message: 'Booking not found' });
      return;
    }

    if (req.body.topic !== undefined) {
      const topic = String(req.body.topic || '').trim();
      if (!topic) {
        res.status(400).json({ success: false, message: 'Topic is required' });
        return;
      }
      booking.topic = topic;
    }

    if (req.body.dateTime !== undefined) {
      const startTime = new Date(req.body.dateTime);
      if (Number.isNaN(startTime.getTime())) {
        res.status(400).json({ success: false, message: 'Invalid session date-time' });
        return;
      }
      booking.dateTime = startTime;
    }

    if (req.body.duration !== undefined) {
      booking.duration = Math.max(Number(req.body.duration) || booking.duration || 30, 15);
    }

    if (status && !['pending', 'accepted', 'completed', 'cancelled'].includes(status)) {
      res.status(400).json({ success: false, message: 'Invalid booking status' });
      return;
    }

    if (meetingLink !== undefined) {
      booking.meetingLink = String(meetingLink).trim() || undefined;
    }

    if (status === 'cancelled' && booking.zoomMeetingId) {
      try {
        await deleteZoomMeeting(booking.zoomMeetingId);
        booking.zoomMeetingId = undefined;
        booking.zoomStartUrl = undefined;
        booking.meetingLink = undefined;
      } catch (err) {
        console.warn(`Zoom cleanup failed for booking ${booking._id}: ${getErrorMessage(err, 'The Zoom meeting could not be deleted.')}`);
      }
    }

    if (status === 'accepted') {
      if (booking.zoomMeetingId) {
        await updateZoomMeeting(booking.zoomMeetingId, {
          topic: `1:1 Session - ${booking.topic}`,
          startTime: booking.dateTime,
          duration: booking.duration || 30,
        });
      } else if (!booking.meetingLink) {
        const zoomMeeting = await createZoomMeeting({
          topic: `1:1 Session - ${booking.topic}`,
          startTime: booking.dateTime,
          duration: booking.duration || 30,
        });
        booking.meetingLink = zoomMeeting.join_url;
        booking.zoomMeetingId = String(zoomMeeting.id);
        booking.zoomStartUrl = zoomMeeting.start_url;
      }
    } else if (!status && booking.status === 'accepted' && booking.zoomMeetingId) {
      await updateZoomMeeting(booking.zoomMeetingId, {
        topic: `1:1 Session - ${booking.topic}`,
        startTime: booking.dateTime,
        duration: booking.duration || 30,
      });
    }

    if (status) booking.status = status;

    await booking.save();
    const populatedBooking = await populateBooking(String(booking._id));
    res.json({ success: true, booking: populatedBooking });
  } catch (err) {
    sendBookingError(res, err, 'Unable to update appointment. Please try again.');
  }
};
