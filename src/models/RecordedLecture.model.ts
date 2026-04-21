import mongoose, { Document, Schema } from 'mongoose';

export type VideoType = 'youtube' | 'drive' | 'google_meet' | 'other';

export interface IRecordedLecture extends Document {
  batch: mongoose.Types.ObjectId;
  title: string;
  description: string;
  videoUrl: string;
  videoType: VideoType;
  order: number;
  uploadedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const recordedLectureSchema = new Schema<IRecordedLecture>(
  {
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    videoUrl: { type: String, required: true },
    videoType: { type: String, enum: ['youtube', 'drive', 'google_meet', 'other'], default: 'other' },
    order: { type: Number, default: 0 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

recordedLectureSchema.index({ batch: 1, order: 1 });

export const RecordedLecture = mongoose.model<IRecordedLecture>('RecordedLecture', recordedLectureSchema);
