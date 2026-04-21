import mongoose, { Document, Schema } from 'mongoose';

export interface ILectureProgress extends Document {
  lecture: mongoose.Types.ObjectId;
  student: mongoose.Types.ObjectId;
  batch: mongoose.Types.ObjectId;
  watchDuration: number; // in seconds
  isCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const lectureProgressSchema = new Schema<ILectureProgress>(
  {
    lecture: { type: Schema.Types.ObjectId, ref: 'RecordedLecture', required: true },
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
    watchDuration: { type: Number, default: 0 },
    isCompleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One progress record per student per lecture
lectureProgressSchema.index({ lecture: 1, student: 1 }, { unique: true });
lectureProgressSchema.index({ batch: 1, student: 1 });

export const LectureProgress = mongoose.model<ILectureProgress>('LectureProgress', lectureProgressSchema);
