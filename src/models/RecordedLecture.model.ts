import mongoose, { Document, Schema } from 'mongoose';

export type VideoType = 'youtube' | 'drive' | 'google_meet' | 'zoom' | 'other';
export type RecordingSource = 'manual' | 'zoom';
export type RecordingStatus = 'pending' | 'available';

export interface IRecordedLecture extends Document {
  batch: mongoose.Types.ObjectId;
  liveClass?: mongoose.Types.ObjectId;
  title: string;
  description: string;
  videoUrl: string;
  videoType: VideoType;
  recordingSource: RecordingSource;
  recordingStatus: RecordingStatus;
  zoomRecordingFileId?: string;
  zoomRecordingMeetingId?: string;
  zoomDownloadUrl?: string;
  zoomPlayUrl?: string;
  zoomShareUrl?: string;
  recordingStartedAt?: Date;
  recordingCompletedAt?: Date;
  order: number;
  uploadedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const recordedLectureSchema = new Schema<IRecordedLecture>(
  {
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
    liveClass: { type: Schema.Types.ObjectId, ref: 'LiveClass' },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    videoUrl: { type: String, required: true },
    videoType: { type: String, enum: ['youtube', 'drive', 'google_meet', 'zoom', 'other'], default: 'other' },
    recordingSource: { type: String, enum: ['manual', 'zoom'], default: 'manual' },
    recordingStatus: { type: String, enum: ['pending', 'available'], default: 'available' },
    zoomRecordingFileId: { type: String, trim: true },
    zoomRecordingMeetingId: { type: String, trim: true },
    zoomDownloadUrl: { type: String },
    zoomPlayUrl: { type: String },
    zoomShareUrl: { type: String },
    recordingStartedAt: { type: Date },
    recordingCompletedAt: { type: Date },
    order: { type: Number, default: 0 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

recordedLectureSchema.index({ batch: 1, order: 1 });
recordedLectureSchema.index({ liveClass: 1 }, { unique: true, sparse: true });
recordedLectureSchema.index({ recordingSource: 1, recordingStatus: 1 });

export const RecordedLecture = mongoose.model<IRecordedLecture>('RecordedLecture', recordedLectureSchema);
