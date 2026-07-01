import mongoose, { Document, Schema } from 'mongoose';
import { VideoType } from './RecordedLecture.model';

export interface IFoundationResource extends Document {
  title: string;
  description: string;
  videoUrl: string;
  videoType: VideoType;
  order: number;
  uploadedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const foundationResourceSchema = new Schema<IFoundationResource>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    videoUrl: { type: String, required: true, trim: true },
    videoType: { type: String, enum: ['youtube', 'drive', 'google_meet', 'zoom', 'other'], default: 'other' },
    order: { type: Number, default: 0 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

foundationResourceSchema.index({ order: 1, createdAt: -1 });

export const FoundationResource = mongoose.model<IFoundationResource>('FoundationResource', foundationResourceSchema);
