import mongoose, { Document, Schema } from 'mongoose';

export type LiveClassStatus = 'scheduled' | 'live' | 'ended';

export interface ILiveClass extends Document {
  batch: mongoose.Types.ObjectId;
  classNumber: string;
  topic: string;
  meetingLink: string;
  scheduledAt: Date;
  duration: number; // minutes
  status: LiveClassStatus;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const liveClassSchema = new Schema<ILiveClass>(
  {
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
    classNumber: { type: String, required: true, trim: true },
    topic: { type: String, required: true, trim: true },
    meetingLink: { type: String, required: true },
    scheduledAt: { type: Date, required: true },
    duration: { type: Number, required: true, default: 60 },
    status: { type: String, enum: ['scheduled', 'live', 'ended'], default: 'scheduled' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

liveClassSchema.index({ batch: 1, scheduledAt: -1 });
liveClassSchema.index({ scheduledAt: 1, status: 1 });

export const LiveClass = mongoose.model<ILiveClass>('LiveClass', liveClassSchema);
