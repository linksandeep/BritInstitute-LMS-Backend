import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { Assignment } from '../models/Assignment.model';
import { Batch } from '../models/Batch.model';

export const createAssignment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { batch, title, description, dueDate, attachmentUrl } = req.body;
    if (!batch || !title || !description || !dueDate) {
      res.status(400).json({ success: false, message: 'Batch, title, description and dueDate are required' });
      return;
    }
    const assignment = await Assignment.create({
      batch, title, description, dueDate, attachmentUrl: attachmentUrl || '',
      createdBy: req.user!.id,
    });
    res.status(201).json({ success: true, assignment });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getAssignmentsByBatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const assignments = await Assignment.find({ batch: req.params.batchId }).sort({ dueDate: 1 });
    res.json({ success: true, assignments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getStudentAssignments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const batches = await Batch.find({ students: req.user!.id, isActive: true });
    const batchIds = batches.map(b => b._id);
    const assignments = await Assignment.find({ batch: { $in: batchIds } }).sort({ dueDate: 1 });
    res.json({ success: true, assignments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getAllAssignments = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const assignments = await Assignment.find().populate('batch', 'name').sort({ createdAt: -1 });
    res.json({ success: true, assignments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const updateAssignment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const assignment = await Assignment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!assignment) {
      res.status(404).json({ success: false, message: 'Assignment not found' });
      return;
    }
    res.json({ success: true, assignment });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const deleteAssignment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const assignment = await Assignment.findByIdAndDelete(req.params.id);
    if (!assignment) {
      res.status(404).json({ success: false, message: 'Assignment not found' });
      return;
    }
    res.json({ success: true, message: 'Assignment deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};
