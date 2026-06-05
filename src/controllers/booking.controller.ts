import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { Booking } from '../models/Booking.model';
import { User } from '../models/User.model';
import { createZoomMeeting, deleteZoomMeeting, updateZoomMeeting, ZoomApiError } from '../services/zoom.service';
import { formatUkTime, getUkDateBounds, parseUkDate, parseUkDateTime } from '../utils/ukTime';

const BOOKING_SLOT_STATUSES = ['pending', 'accepted'] as const;
const DEFAULT_SLOT_MINUTES = 30;
const SLOT_START_HOUR = 10;
const SLOT_END_HOUR = 19;

type BlockingBooking = {
  _id: unknown;
  dateTime: Date;
  duration?: number;
};

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

const parseDuration = (value: unknown, fallback = DEFAULT_SLOT_MINUTES): number => {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return fallback;
  return Math.max(Math.round(duration), 15);
};

const parseSessionStartTime = (value: unknown): Date | null => {
  const startTime = parseUkDateTime(value);
  if (!startTime) return null;
  startTime.setSeconds(0, 0);
  return startTime;
};

const getBookingEndTime = (booking: BlockingBooking): Date =>
  new Date(booking.dateTime.getTime() + parseDuration(booking.duration) * 60 * 1000);

const getDateBounds = getUkDateBounds;

const parseAvailabilityDate = (value: unknown): { date: Date; key: string } | null => {
  const key = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;

  const [, y, m, d] = match;
  const date = parseUkDate(`${y}-${m}-${d}`);
  if (!date) return null;

  return { date, key };
};

const findMentorSlotConflict = async (
  mentor: string,
  startTime: Date,
  duration: number,
  excludeBookingId?: string
) => {
  const requestedEnd = new Date(startTime.getTime() + duration * 60 * 1000);
  const { dayStart, dayEnd } = getDateBounds(startTime);
  const query: Record<string, unknown> = {
    mentor,
    status: { $in: BOOKING_SLOT_STATUSES },
    dateTime: { $gte: dayStart, $lt: dayEnd },
  };

  if (excludeBookingId) {
    query._id = { $ne: excludeBookingId };
  }

  const bookings = await Booking.find(query).select('dateTime duration status');
  return bookings.find((booking) => booking.dateTime < requestedEnd && getBookingEndTime(booking) > startTime) || null;
};

const sendSlotConflict = (res: Response): void => {
  res.status(409).json({
    success: false,
    message: 'This slot is already booked for this mentor. Please choose another available time.',
  });
};

const clearZoomDetails = async (booking: { zoomMeetingId?: string; zoomStartUrl?: string; meetingLink?: string; _id: unknown }) => {
  if (!booking.zoomMeetingId) return;

  try {
    await deleteZoomMeeting(booking.zoomMeetingId);
  } catch (err) {
    console.warn(`Zoom cleanup failed for booking ${booking._id}: ${getErrorMessage(err, 'The Zoom meeting could not be deleted.')}`);
  }

  booking.zoomMeetingId = undefined;
  booking.zoomStartUrl = undefined;
  booking.meetingLink = undefined;
};

// Fetch available mentors (admins)
export const getMentors = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const mentors = await User.find({ role: 'teacher', isActive: true }).select('name username');
    res.json({ success: true, mentors });
  } catch (err) {
    sendBookingError(res, err, 'Unable to load mentors. Please try again.');
  }
};

// Fetch bookable slots for a mentor on one date
export const getMentorAvailability = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { mentorId } = req.params;
    const parsedDate = parseAvailabilityDate(req.query.date);

    if (!parsedDate) {
      res.status(400).json({ success: false, message: 'A valid date is required in YYYY-MM-DD format' });
      return;
    }

    const mentorExists = await User.findOne({ _id: mentorId, role: { $in: ['teacher', 'admin', 'superadmin'] }, isActive: true });
    if (!mentorExists) {
      res.status(404).json({ success: false, message: 'Teacher or admin not found' });
      return;
    }

    const { dayStart, dayEnd } = getDateBounds(parsedDate.date);
    const bookings = await Booking.find({
      mentor: mentorId,
      status: { $in: BOOKING_SLOT_STATUSES },
      dateTime: { $gte: dayStart, $lt: dayEnd },
    }).select('dateTime duration status topic');

    const now = new Date();
    const slots = [];

    for (let hour = SLOT_START_HOUR; hour < SLOT_END_HOUR; hour += 1) {
      for (const minute of [0, 30]) {
        const slotStart = parseUkDateTime(`${parsedDate.key}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)!;
        const slotEnd = new Date(slotStart.getTime() + DEFAULT_SLOT_MINUTES * 60 * 1000);
        const booking = bookings.find((item) => item.dateTime < slotEnd && getBookingEndTime(item) > slotStart);
        const status = booking ? 'booked' : slotStart < now ? 'past' : 'available';

        slots.push({
          dateTime: slotStart.toISOString(),
          label: formatUkTime(slotStart),
          status,
          bookingId: booking ? String(booking._id) : undefined,
        });
      }
    }

    res.json({ success: true, date: parsedDate.key, slotDuration: DEFAULT_SLOT_MINUTES, slots });
  } catch (err) {
    sendBookingError(res, err, 'Unable to load mentor availability. Please try again.');
  }
};

// Student creates a booking request
export const createBooking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { mentor, topic, dateTime } = req.body;
    const duration = parseDuration(req.body.duration);
    const student = req.user!.id;

    if (!mentor || !topic || !dateTime) {
      res.status(400).json({ success: false, message: 'Mentor, topic and date-time are required' });
      return;
    }

    const startTime = parseSessionStartTime(dateTime);
    if (!startTime) {
      res.status(400).json({ success: false, message: 'Invalid session date-time' });
      return;
    }

    if (startTime < new Date()) {
      res.status(400).json({ success: false, message: 'Please choose a future time slot' });
      return;
    }

    const mentorExists = await User.findOne({ _id: mentor, role: { $in: ['teacher', 'admin', 'superadmin'] }, isActive: true });
    if (!mentorExists) {
      res.status(404).json({ success: false, message: 'Teacher or admin not found' });
      return;
    }

    const conflict = await findMentorSlotConflict(String(mentor), startTime, duration);
    if (conflict) {
      sendSlotConflict(res);
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

    const populatedBooking = await populateBooking(String(booking._id));
    res.status(201).json({ success: true, booking: populatedBooking });
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

// Reschedule a student booking and free the old slot
export const rescheduleBooking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const student = req.user!.id;

    const booking = await Booking.findOne({ _id: id, student });
    if (!booking) {
      res.status(404).json({ success: false, message: 'Booking not found' });
      return;
    }

    if (booking.status === 'completed' || booking.status === 'cancelled') {
      res.status(400).json({ success: false, message: 'Only pending or accepted sessions can be rescheduled' });
      return;
    }

    const mentor = String(req.body.mentor || booking.mentor);
    const topic = String(req.body.topic || booking.topic).trim();
    const startTime = req.body.dateTime !== undefined ? parseSessionStartTime(req.body.dateTime) : booking.dateTime;
    const duration = parseDuration(req.body.duration, booking.duration || DEFAULT_SLOT_MINUTES);

    if (!mentor || !topic || !startTime) {
      res.status(400).json({ success: false, message: 'Mentor, topic and date-time are required' });
      return;
    }

    if (startTime < new Date()) {
      res.status(400).json({ success: false, message: 'Please choose a future time slot' });
      return;
    }

    const mentorExists = await User.findOne({ _id: mentor, role: { $in: ['teacher', 'admin', 'superadmin'] }, isActive: true });
    if (!mentorExists) {
      res.status(404).json({ success: false, message: 'Teacher or admin not found' });
      return;
    }

    const conflict = await findMentorSlotConflict(mentor, startTime, duration, String(booking._id));
    if (conflict) {
      sendSlotConflict(res);
      return;
    }

    if (booking.zoomMeetingId) {
      await clearZoomDetails(booking);
    }

    booking.mentor = mentorExists._id;
    booking.topic = topic;
    booking.dateTime = startTime;
    booking.duration = duration;
    booking.status = 'pending';
    await booking.save();

    const populatedBooking = await populateBooking(String(booking._id));
    res.json({
      success: true,
      message: 'Session rescheduled. It will be reviewed again before the meeting link is issued.',
      booking: populatedBooking,
    });
  } catch (err) {
    sendBookingError(res, err, 'Unable to reschedule appointment. Please try again.');
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

    const nextTopic = req.body.topic !== undefined ? String(req.body.topic || '').trim() : booking.topic;
    const nextStartTime = req.body.dateTime !== undefined ? parseSessionStartTime(req.body.dateTime) : booking.dateTime;
    const nextDuration = req.body.duration !== undefined ? parseDuration(req.body.duration, booking.duration || DEFAULT_SLOT_MINUTES) : booking.duration || DEFAULT_SLOT_MINUTES;
    const nextStatus = status || booking.status;
    const nextMentor = String(req.body.mentor || booking.mentor);

    if (req.body.topic !== undefined) {
      if (!nextTopic) {
        res.status(400).json({ success: false, message: 'Topic is required' });
        return;
      }
    }

    if (!nextStartTime) {
      res.status(400).json({ success: false, message: 'Invalid session date-time' });
      return;
    }

    if (status && !['pending', 'accepted', 'completed', 'cancelled'].includes(status)) {
      res.status(400).json({ success: false, message: 'Invalid booking status' });
      return;
    }

    if (BOOKING_SLOT_STATUSES.includes(nextStatus)) {
      const conflict = await findMentorSlotConflict(nextMentor, nextStartTime, nextDuration, String(booking._id));
      if (conflict) {
        sendSlotConflict(res);
        return;
      }
    }

    if (req.body.mentor !== undefined) {
      const mentorExists = await User.findOne({ _id: nextMentor, role: { $in: ['teacher', 'admin', 'superadmin'] }, isActive: true });
      if (!mentorExists) {
        res.status(404).json({ success: false, message: 'Teacher or admin not found' });
        return;
      }
      booking.mentor = mentorExists._id;
    }

    booking.topic = nextTopic;
    booking.dateTime = nextStartTime;
    booking.duration = nextDuration;

    if (nextStatus !== 'completed' && nextStatus !== 'cancelled' && booking.dateTime < new Date()) {
      res.status(400).json({ success: false, message: 'Please choose a future time slot' });
      return;
    }

    if (meetingLink !== undefined) {
      booking.meetingLink = String(meetingLink).trim() || undefined;
    }

    if (status === 'cancelled' && booking.zoomMeetingId) {
      await clearZoomDetails(booking);
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
