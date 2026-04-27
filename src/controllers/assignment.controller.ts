import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { Assignment } from '../models/Assignment.model';
import { AssignmentSubmission } from '../models/AssignmentSubmission.model';
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
    const submissions = await AssignmentSubmission.find({
      assignment: { $in: assignments.map((assignment) => assignment._id) },
      student: req.user!.id,
    });
    const submissionByAssignment = new Map(submissions.map((submission) => [submission.assignment.toString(), submission]));
    const enrichedAssignments = assignments.map((assignment) => ({
      ...assignment.toObject(),
      submission: submissionByAssignment.get(String(assignment._id)) || null,
    }));

    res.json({ success: true, assignments: enrichedAssignments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getAllAssignments = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const assignments = await Assignment.find()
      .populate({ path: 'batch', select: 'name course', populate: { path: 'course', select: 'title' } })
      .sort({ createdAt: -1 });
    const submissionCounts = await AssignmentSubmission.aggregate([
      { $group: { _id: '$assignment', count: { $sum: 1 } } },
    ]);
    const countByAssignment = new Map(submissionCounts.map((item) => [String(item._id), item.count]));
    const enrichedAssignments = assignments.map((assignment) => ({
      ...assignment.toObject(),
      submissionCount: countByAssignment.get(String(assignment._id)) || 0,
    }));

    res.json({ success: true, assignments: enrichedAssignments });
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
    await AssignmentSubmission.deleteMany({ assignment: req.params.id });
    res.json({ success: true, message: 'Assignment deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const submitAssignment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { driveLink, fileLink, repoLink, notes } = req.body;

    if (!driveLink && !fileLink && !repoLink && !notes) {
      res.status(400).json({ success: false, message: 'Add a Drive link, file link, repo link, or notes before submitting' });
      return;
    }

    const assignment = await Assignment.findById(id);
    if (!assignment) {
      res.status(404).json({ success: false, message: 'Assignment not found' });
      return;
    }

    const batch = await Batch.findOne({ _id: assignment.batch, students: req.user!.id, isActive: true });
    if (!batch) {
      res.status(403).json({ success: false, message: 'You are not enrolled in this assignment batch' });
      return;
    }

    const submittedAt = new Date();
    const status = submittedAt.getTime() > new Date(assignment.dueDate).getTime() ? 'late' : 'submitted';
    const submission = await AssignmentSubmission.findOneAndUpdate(
      { assignment: id, student: req.user!.id },
      {
        assignment: id,
        student: req.user!.id,
        batch: assignment.batch,
        driveLink: driveLink || '',
        fileLink: fileLink || '',
        repoLink: repoLink || '',
        notes: notes || '',
        status,
        submittedAt,
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, submission });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getAssignmentSubmissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) {
      res.status(404).json({ success: false, message: 'Assignment not found' });
      return;
    }

    const submissions = await AssignmentSubmission.find({ assignment: req.params.id })
      .populate('student', 'name username')
      .sort({ submittedAt: -1 });

    res.json({ success: true, submissions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};
