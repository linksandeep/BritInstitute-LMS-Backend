import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { LiveClass } from '../models/LiveClass.model';
import { Attendance } from '../models/Attendance.model';
import { Batch } from '../models/Batch.model';
import { createZoomMeeting, deleteZoomMeeting, updateZoomMeeting, ZoomApiError } from '../services/zoom.service';
import { deleteRecordedLectureForLiveClass, syncRecordedLectureForLiveClass } from '../services/recordedLectureSync.service';

const sendLiveClassError = (res: Response, err: unknown, fallback: string): void => {
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

export const createLiveClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { batch, classNumber, topic, scheduledAt, duration } = req.body;
    if (!batch || !classNumber || !topic || !scheduledAt) {
      res.status(400).json({ success: false, message: 'All fields are required' });
      return;
    }

    const startTime = new Date(scheduledAt);
    if (Number.isNaN(startTime.getTime())) {
      res.status(400).json({ success: false, message: 'Invalid scheduled date' });
      return;
    }

    const meetingDuration = Number(duration) || 60;
    const zoomMeeting = await createZoomMeeting({
      topic: `${classNumber} - ${topic}`,
      startTime,
      duration: meetingDuration,
    });

    const liveClass = await LiveClass.create({
      batch,
      classNumber,
      topic,
      meetingLink: zoomMeeting.join_url,
      zoomMeetingId: String(zoomMeeting.id),
      zoomStartUrl: zoomMeeting.start_url,
      scheduledAt: startTime,
      duration: meetingDuration,
      createdBy: req.user!.id, status: 'scheduled',
    });
    await syncRecordedLectureForLiveClass(liveClass);
    res.status(201).json({ success: true, liveClass });
  } catch (err) {
    sendLiveClassError(res, err, 'Unable to create live class. Please try again.');
  }
};

export const getLiveClassesByBatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { batchId } = req.params;
    const liveClasses = await LiveClass.find({ batch: batchId }).sort({ scheduledAt: -1 });
    res.json({ success: true, liveClasses });
  } catch (err) {
    sendLiveClassError(res, err, 'Unable to load live classes. Please try again.');
  }
};

export const getStudentLiveClasses = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Find all batches this student is enrolled in
    const batches = await Batch.find({ students: req.user!.id, isActive: true });
    const batchIds = batches.map(b => b._id);

    const liveClasses = await LiveClass.find({ batch: { $in: batchIds } }).sort({ scheduledAt: -1 });

    // Attach attendance status
    const enriched = await Promise.all(
      liveClasses.map(async (cls) => {
        const att = await Attendance.findOne({ liveClass: cls._id, student: req.user!.id });
        const liveClass = cls.toObject();
        delete liveClass.zoomStartUrl;
        return {
          ...liveClass,
          attendance: att ? att.status : null,
        };
      })
    );
    res.json({ success: true, liveClasses: enriched });
  } catch (err) {
    sendLiveClassError(res, err, 'Unable to load your live classes. Please try again.');
  }
};

export const getAllLiveClasses = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const liveClasses = await LiveClass.find().populate('batch', 'name').sort({ scheduledAt: -1 });
    res.json({ success: true, liveClasses });
  } catch (err) {
    sendLiveClassError(res, err, 'Unable to load live classes. Please try again.');
  }
};

export const updateLiveClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await LiveClass.findById(req.params.id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Live class not found' });
      return;
    }

    const allowedUpdates: Partial<{
      batch: string;
      classNumber: string;
      topic: string;
      scheduledAt: Date;
      duration: number;
      meetingLink: string;
    }> = {};

    if (req.body.batch !== undefined) allowedUpdates.batch = req.body.batch;
    if (req.body.classNumber !== undefined) allowedUpdates.classNumber = req.body.classNumber;
    if (req.body.topic !== undefined) allowedUpdates.topic = req.body.topic;
    if (req.body.scheduledAt !== undefined) {
      const startTime = new Date(req.body.scheduledAt);
      if (Number.isNaN(startTime.getTime())) {
        res.status(400).json({ success: false, message: 'Invalid scheduled date' });
        return;
      }
      allowedUpdates.scheduledAt = startTime;
    }
    if (req.body.duration !== undefined) allowedUpdates.duration = Number(req.body.duration) || existing.duration;

    if (existing.zoomMeetingId) {
      await updateZoomMeeting(existing.zoomMeetingId, {
        topic: `${allowedUpdates.classNumber || existing.classNumber} - ${allowedUpdates.topic || existing.topic}`,
        startTime: allowedUpdates.scheduledAt || existing.scheduledAt,
        duration: allowedUpdates.duration || existing.duration,
      });
    } else if (req.body.meetingLink !== undefined) {
      allowedUpdates.meetingLink = req.body.meetingLink;
    }

    const cls = await LiveClass.findByIdAndUpdate(req.params.id, allowedUpdates, { new: true });
    if (!cls) {
      res.status(404).json({ success: false, message: 'Live class not found' });
      return;
    }
    await syncRecordedLectureForLiveClass(cls);
    res.json({ success: true, liveClass: cls });
  } catch (err) {
    sendLiveClassError(res, err, 'Unable to update live class. Please try again.');
  }
};

export const deleteLiveClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cls = await LiveClass.findById(req.params.id);
    if (!cls) {
      res.status(404).json({ success: false, message: 'Live class not found' });
      return;
    }

    let warning: string | undefined;
    if (cls.zoomMeetingId) {
      try {
        await deleteZoomMeeting(cls.zoomMeetingId);
      } catch (err) {
        warning = getErrorMessage(err, 'The Zoom meeting could not be deleted.');
        console.warn(`Zoom cleanup failed for live class ${cls._id}: ${warning}`);
      }
    }

    await cls.deleteOne();
    await deleteRecordedLectureForLiveClass(String(cls._id));
    res.json({
      success: true,
      message: warning ? 'Live class deleted from LMS. Zoom cleanup needs attention.' : 'Live class deleted',
      warning,
    });
  } catch (err) {
    sendLiveClassError(res, err, 'Unable to delete live class. Please try again.');
  }
};

// Student joins — mark as present
export const markAttend = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const student = req.user!.id;

    const cls = await LiveClass.findById(id);
    if (!cls) {
      res.status(404).json({ success: false, message: 'Live class not found' });
      return;
    }

    if (cls.status === 'ended') {
      res.status(400).json({ success: false, message: 'This class has already ended' });
      return;
    }

    // Allow students to join from 30 minutes before start until the scheduled class duration ends.
    const now = new Date();
    const scheduledAt = new Date(cls.scheduledAt);
    const joinOpensAt = new Date(scheduledAt.getTime() - 30 * 60 * 1000);
    const classEndsAt = new Date(scheduledAt.getTime() + cls.duration * 60 * 1000);

    if (now < joinOpensAt) {
       res.status(400).json({ success: false, message: 'Class has not started yet' });
       return;
    }

    if (now > classEndsAt) {
       res.status(400).json({ success: false, message: 'This class has already finished' });
       return;
    }

    // upsert attendance
    const att = await Attendance.findOneAndUpdate(
      { liveClass: id, student },
      { liveClass: id, student, batch: cls.batch, status: 'present', markedAt: new Date() },
      { upsert: true, new: true }
    );

    res.json({ success: true, attendance: att });
  } catch (err) {
    sendLiveClassError(res, err, 'Unable to join this class. Please try again.');
  }
};

// Admin: view attendance for a class
export const getClassAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { classId } = req.params;
    const attendance = await Attendance.find({ liveClass: classId }).populate('student', 'name username');
    res.json({ success: true, attendance });
  } catch (err) {
    sendLiveClassError(res, err, 'Unable to load class attendance. Please try again.');
  }
};

// Student: get own attendance summary
export const getStudentAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const studentId = req.params.studentId || req.user!.id;
    const attendance = await Attendance.find({ student: studentId })
      .populate('liveClass', 'classNumber topic scheduledAt')
      .sort({ createdAt: -1 });
    res.json({ success: true, attendance });
  } catch (err) {
    sendLiveClassError(res, err, 'Unable to load attendance. Please try again.');
  }
};

// Background use: auto-mark absent after class ends
export const autoMarkAbsent = async (liveClassId: string): Promise<void> => {
  const cls = await LiveClass.findById(liveClassId);
  if (!cls) return;

  const batch = await Batch.findById(cls.batch).populate('students');
  if (batch && batch.students) {
    for (const student of batch.students as unknown as { _id: string, isActive: boolean }[]) {
      if (!student.isActive) continue;
      // Only create if no attendance record exists yet
      await Attendance.findOneAndUpdate(
        { liveClass: cls._id, student: student._id },
        { $setOnInsert: { liveClass: cls._id, student: student._id, batch: cls.batch, status: 'absent', markedAt: new Date() } },
        { upsert: true, new: false }
      );
    }
  }

  // Mark class as ended
  await LiveClass.findByIdAndUpdate(liveClassId, { status: 'ended' });
  console.log(`📋 Auto-marked absent for class ${cls.classNumber} (${cls.topic})`);
};
