import mongoose, { Document, Schema } from 'mongoose';

export interface IBatch extends Document {
  name: string;
  description?: string;
  course: mongoose.Types.ObjectId;
  students: mongoose.Types.ObjectId[];
  isActive: boolean;
  startDate: Date;
  endDate?: Date;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const batchSchema = new Schema<IBatch>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    students: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    isActive: { type: Boolean, default: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export const Batch = mongoose.model<IBatch>('Batch', batchSchema);
