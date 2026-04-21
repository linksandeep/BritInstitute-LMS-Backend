import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { RecordedLecture } from '../models/RecordedLecture.model';
import { LectureProgress } from '../models/LectureProgress.model';
import { Batch } from '../models/Batch.model';

export const createRecordedLecture = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { batch, title, description, videoUrl, videoType, order } = req.body;
    if (!batch || !title || !videoUrl) {
      res.status(400).json({ success: false, message: 'Batch, title and videoUrl are required' });
      return;
    }
    const lecture = await RecordedLecture.create({
      batch, title, description: description || '', videoUrl, videoType: videoType || 'other',
      order: order || 0, uploadedBy: req.user!.id,
    });
    res.status(201).json({ success: true, lecture });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getLecturesByBatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lectures = await RecordedLecture.find({ batch: req.params.batchId }).sort({ order: 1, createdAt: -1 });
    res.json({ success: true, lectures });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getStudentLectures = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const batches = await Batch.find({ students: req.user!.id, isActive: true });
    const batchIds = batches.map(b => b._id);
    const lectures = await RecordedLecture.find({ batch: { $in: batchIds } }).sort({ order: 1, createdAt: -1 });

    const enriched = await Promise.all(
      lectures.map(async (lec) => {
        const prog = await LectureProgress.findOne({ lecture: lec._id, student: req.user!.id });
        return {
          ...lec.toObject(),
          isCompleted: prog ? prog.isCompleted : false,
          watchDuration: prog ? prog.watchDuration : 0,
        };
      })
    );
    res.json({ success: true, lectures: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const updateProgress = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params; // lecture ID
    const { watchDuration, isCompleted } = req.body;
    const student = req.user!.id;

    const lecture = await RecordedLecture.findById(id);
    if (!lecture) {
      res.status(404).json({ success: false, message: 'Lecture not found' });
      return;
    }

    const prog = await LectureProgress.findOneAndUpdate(
      { lecture: id, student },
      { 
        $set: { lecture: id, student, batch: lecture.batch },
        $max: { watchDuration: watchDuration || 0 }
      },
      { upsert: true, new: true }
    );

    if (isCompleted && !prog.isCompleted) {
       prog.isCompleted = true;
       await prog.save();
    }

    res.json({ success: true, progress: prog });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getAllLectures = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lectures = await RecordedLecture.find().populate('batch', 'name').sort({ createdAt: -1 });
    res.json({ success: true, lectures });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const updateLecture = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lecture = await RecordedLecture.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!lecture) {
      res.status(404).json({ success: false, message: 'Lecture not found' });
      return;
    }
    res.json({ success: true, lecture });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const deleteLecture = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lecture = await RecordedLecture.findByIdAndDelete(req.params.id);
    if (!lecture) {
      res.status(404).json({ success: false, message: 'Lecture not found' });
      return;
    }
    res.json({ success: true, message: 'Lecture deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};
