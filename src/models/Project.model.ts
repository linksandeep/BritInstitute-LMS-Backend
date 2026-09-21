import mongoose, { Document, Schema } from 'mongoose';

export type ProjectResourceType = 'drive' | 'zip';

export interface IProject extends Document {
  batch: mongoose.Types.ObjectId;
  name: string;
  description: string;
  skills: string[];
  resourceType: ProjectResourceType;
  resourceUrl?: string;
  fileName?: string;
  originalFileName?: string;
  uploadedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<IProject>(
  {
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    skills: [{ type: String, trim: true }],
    resourceType: { type: String, enum: ['drive', 'zip'], required: true },
    resourceUrl: { type: String, trim: true },
    fileName: { type: String, select: false },
    originalFileName: { type: String, trim: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

projectSchema.index({ batch: 1, createdAt: -1 });
projectSchema.index({ skills: 1 });

export const Project = mongoose.model<IProject>('Project', projectSchema);
