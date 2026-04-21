import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { LiveClass } from '../models/LiveClass.model';
import { Attendance } from '../models/Attendance.model';
import { User } from '../models/User.model';
import { Batch } from '../models/Batch.model';

export const createLiveClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { batch, classNumber, topic, meetingLink, scheduledAt, duration } = req.body;
    if (!batch || !classNumber || !topic || !meetingLink || !scheduledAt) {
      res.status(400).json({ success: false, message: 'All fields are required' });
      return;
    }
    const liveClass = await LiveClass.create({
      batch, classNumber, topic, meetingLink, scheduledAt, duration: duration || 60,
      createdBy: req.user!.id, status: 'scheduled',
    });
    res.status(201).json({ success: true, liveClass });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getLiveClassesByBatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { batchId } = req.params;
    const liveClasses = await LiveClass.find({ batch: batchId }).sort({ scheduledAt: -1 });
    res.json({ success: true, liveClasses });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
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
        return {
          ...cls.toObject(),
          attendance: att ? att.status : null,
        };
      })
    );
    res.json({ success: true, liveClasses: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getAllLiveClasses = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const liveClasses = await LiveClass.find().populate('batch', 'name').sort({ scheduledAt: -1 });
    res.json({ success: true, liveClasses });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const updateLiveClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cls = await LiveClass.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!cls) {
      res.status(404).json({ success: false, message: 'Live class not found' });
      return;
    }
    res.json({ success: true, liveClass: cls });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const deleteLiveClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cls = await LiveClass.findByIdAndDelete(req.params.id);
    if (!cls) {
      res.status(404).json({ success: false, message: 'Live class not found' });
      return;
    }
    res.json({ success: true, message: 'Live class deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
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

    // Check if within 30 minutes of scheduled time
    const now = new Date();
    const scheduledAt = new Date(cls.scheduledAt);
    const diffMinutes = (now.getTime() - scheduledAt.getTime()) / (1000 * 60);

    if (diffMinutes < -30) {
       res.status(400).json({ success: false, message: 'Class has not started yet' });
       return;
    }

    if (diffMinutes > 30) {
       res.status(400).json({ success: false, message: 'Attendance window closed (30 min limit)' });
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
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

// Admin: view attendance for a class
export const getClassAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { classId } = req.params;
    const attendance = await Attendance.find({ liveClass: classId }).populate('student', 'name username');
    res.json({ success: true, attendance });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
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
    res.status(500).json({ success: false, message: 'Server error', error: err });
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
