import mongoose, { Document, Schema } from 'mongoose';

export interface ICourse extends Document {
  title: string;
  description: string;
  createdBy: mongoose.Types.ObjectId;
  isPublic: boolean;
  assignedTeachers: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const courseSchema = new Schema<ICourse>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isPublic: { type: Boolean, default: false },
    assignedTeachers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

courseSchema.index({ createdBy: 1 });
courseSchema.index({ isPublic: 1 });
courseSchema.index({ assignedTeachers: 1 });

export const Course = mongoose.model<ICourse>('Course', courseSchema);
