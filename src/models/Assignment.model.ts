import mongoose, { Document, Schema } from 'mongoose';

export interface IAssignment extends Document {
  batch: mongoose.Types.ObjectId;
  title: string;
  description: string;
  dueDate: Date;
  attachmentUrl?: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const assignmentSchema = new Schema<IAssignment>(
  {
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    dueDate: { type: Date, required: true },
    attachmentUrl: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

assignmentSchema.index({ batch: 1, dueDate: 1 });

export const Assignment = mongoose.model<IAssignment>('Assignment', assignmentSchema);
