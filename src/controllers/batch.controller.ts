import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { Batch } from '../models/Batch.model';
import { User } from '../models/User.model';
import { Attendance } from '../models/Attendance.model';
import { LectureProgress } from '../models/LectureProgress.model';
import { LiveClass } from '../models/LiveClass.model';
import { RecordedLecture } from '../models/RecordedLecture.model';
import { Assignment } from '../models/Assignment.model';

// ─── Create Batch ─────────────────────────────────────────────────────────────
export const createBatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, course, startDate, endDate } = req.body;
    if (!name || !course || !startDate) {
      res.status(400).json({ success: false, message: 'Name, course and start date are required' });
      return;
    }
    const batch = await Batch.create({
      name, description, course, startDate, endDate,
      createdBy: req.user!.id,
    });
    const populated = await Batch.findById(batch._id)
      .populate('course', 'title description')
      .populate('students', 'name username isActive');
    res.status(201).json({ success: true, batch: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

// ─── Get All Batches ──────────────────────────────────────────────────────────
export const getBatches = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const batches = await Batch.find()
      .populate('course', 'title description')
      .populate('students', 'name username isActive')
      .sort({ createdAt: -1 });
    res.json({ success: true, batches });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

// ─── Get Single Batch ─────────────────────────────────────────────────────────
export const getBatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const batch = await Batch.findById(req.params.id)
      .populate('course', 'title description')
      .populate('students', 'name username isActive');
    if (!batch) {
      res.status(404).json({ success: false, message: 'Batch not found' });
      return;
    }
    res.json({ success: true, batch });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

// ─── Update Batch ─────────────────────────────────────────────────────────────
export const updateBatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const batch = await Batch.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('course', 'title description')
      .populate('students', 'name username isActive');
    if (!batch) {
      res.status(404).json({ success: false, message: 'Batch not found' });
      return;
    }
    res.json({ success: true, batch });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

// ─── Delete Batch ─────────────────────────────────────────────────────────────
export const deleteBatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const batch = await Batch.findByIdAndDelete(req.params.id);
    if (!batch) {
      res.status(404).json({ success: false, message: 'Batch not found' });
      return;
    }
    // Clear enrolledCourse for all students in this batch (if not in another batch)
    for (const studentId of batch.students) {
      const otherBatch = await Batch.findOne({ students: studentId, _id: { $ne: batch._id } });
      if (!otherBatch) {
        await User.findByIdAndUpdate(studentId, { $unset: { enrolledCourse: 1 } });
      }
    }
    res.json({ success: true, message: 'Batch deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

// ─── Add Student to Batch ─────────────────────────────────────────────────────
export const addStudentToBatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params; // batchId
    const { studentId } = req.body;

    if (!studentId) {
      res.status(400).json({ success: false, message: 'studentId is required' });
      return;
    }

    const batch = await Batch.findById(id);
    if (!batch) {
      res.status(404).json({ success: false, message: 'Batch not found' });
      return;
    }

    const student = await User.findById(studentId);
    if (!student || student.role !== 'student') {
      res.status(404).json({ success: false, message: 'Student not found' });
      return;
    }

    // Check if already in this batch
    const alreadyIn = batch.students.some(s => s.toString() === studentId);
    if (alreadyIn) {
      res.status(409).json({ success: false, message: 'Student already in this batch' });
      return;
    }

    // Add student to batch
    batch.students.push(student._id as mongoose.Types.ObjectId);
    await batch.save();

    // Update student's enrolledCourse to this batch's course
    await User.findByIdAndUpdate(studentId, { enrolledCourse: batch.course });

    const populated = await Batch.findById(id)
      .populate('course', 'title description')
      .populate('students', 'name username isActive');

    res.json({ success: true, batch: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

// ─── Remove Student from Batch ────────────────────────────────────────────────
export const removeStudentFromBatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, studentId } = req.params;

    const batch = await Batch.findById(id);
    if (!batch) {
      res.status(404).json({ success: false, message: 'Batch not found' });
      return;
    }

    batch.students = batch.students.filter(s => s.toString() !== studentId) as typeof batch.students;
    await batch.save();

    // Clear enrolledCourse if student is not in any other batch
    const otherBatch = await Batch.findOne({ students: studentId, _id: { $ne: id } });
    if (!otherBatch) {
      await User.findByIdAndUpdate(studentId, { $unset: { enrolledCourse: 1 } });
    }

    const populated = await Batch.findById(id)
      .populate('course', 'title description')
      .populate('students', 'name username isActive');

    res.json({ success: true, batch: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

// ─── Get Student Report for a Batch ──────────────────────────────────────────
export const getStudentBatchReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, studentId } = req.params; // batchId, studentId

    const batch = await Batch.findById(id).populate('course', 'title');
    if (!batch) {
      res.status(404).json({ success: false, message: 'Batch not found' });
      return;
    }

    const student = await User.findById(studentId);
    if (!student) {
      res.status(404).json({ success: false, message: 'Student not found' });
      return;
    }

    // 1. Fetch Attendance
    const attendance = await Attendance.find({ batch: id, student: studentId })
      .populate('liveClass', 'classNumber topic scheduledAt');

    // 2. Fetch Video Progress
    const lectures = await RecordedLecture.find({ batch: id }).sort({ order: 1 });
    const progress = await Promise.all(
      lectures.map(async (lec) => {
        const p = await LectureProgress.findOne({ lecture: lec._id, student: studentId });
        return {
          lectureTitle: lec.title,
          watchDuration: p ? p.watchDuration : 0,
          isCompleted: p ? p.isCompleted : false,
          totalDuration: 600, // Conceptually 10 mins (600s) is the target
        };
      })
    );

    res.json({
      success: true,
      report: {
        student: { name: student.name, username: student.username },
        batchName: batch.name,
        courseName: batch.course ? (batch.course as any).title : 'N/A',
        attendance,
        videoProgress: progress,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};
