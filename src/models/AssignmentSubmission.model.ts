import mongoose, { Document, Schema } from 'mongoose';

export type AssignmentSubmissionStatus = 'submitted' | 'late';

export interface IAssignmentSubmission extends Document {
  assignment: mongoose.Types.ObjectId;
  student: mongoose.Types.ObjectId;
  batch: mongoose.Types.ObjectId;
  driveLink?: string;
  fileLink?: string;
  repoLink?: string;
  notes?: string;
  status: AssignmentSubmissionStatus;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const assignmentSubmissionSchema = new Schema<IAssignmentSubmission>(
  {
    assignment: { type: Schema.Types.ObjectId, ref: 'Assignment', required: true },
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
    driveLink: { type: String, trim: true, default: '' },
    fileLink: { type: String, trim: true, default: '' },
    repoLink: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['submitted', 'late'], default: 'submitted' },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

assignmentSubmissionSchema.index({ assignment: 1, student: 1 }, { unique: true });
assignmentSubmissionSchema.index({ batch: 1, submittedAt: -1 });

export const AssignmentSubmission = mongoose.model<IAssignmentSubmission>('AssignmentSubmission', assignmentSubmissionSchema);
