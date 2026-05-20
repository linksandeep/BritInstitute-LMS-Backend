import mongoose, { Document, Schema } from 'mongoose';

export interface ICertificateRequest extends Document {
  student: mongoose.Types.ObjectId;
  batch?: mongoose.Types.ObjectId;
  course?: mongoose.Types.ObjectId;
  status: 'pending' | 'approved' | 'rejected' | 'issued';
  requestedAt: Date;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const certificateRequestSchema = new Schema<ICertificateRequest>(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    batch: { type: Schema.Types.ObjectId, ref: 'Batch' },
    course: { type: Schema.Types.ObjectId, ref: 'Course' },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'issued'], default: 'pending' },
    requestedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

certificateRequestSchema.index({ student: 1, batch: 1, course: 1 }, { unique: true, sparse: true });

export const CertificateRequest = mongoose.model<ICertificateRequest>('CertificateRequest', certificateRequestSchema);
