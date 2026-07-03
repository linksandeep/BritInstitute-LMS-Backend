import mongoose, { Document, Schema } from 'mongoose';

export type StudyMaterialType = 'drive' | 'pdf' | 'doc' | 'slides' | 'sheet' | 'link' | 'other';

export interface IStudyMaterial extends Document {
  batch: mongoose.Types.ObjectId;
  title: string;
  description: string;
  materialUrl: string;
  materialType: StudyMaterialType;
  order: number;
  uploadedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const studyMaterialSchema = new Schema<IStudyMaterial>(
  {
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    materialUrl: { type: String, required: true, trim: true },
    materialType: {
      type: String,
      enum: ['drive', 'pdf', 'doc', 'slides', 'sheet', 'link', 'other'],
      default: 'link',
    },
    order: { type: Number, default: 0 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

studyMaterialSchema.index({ batch: 1, order: 1, createdAt: -1 });
studyMaterialSchema.index({ materialType: 1 });

export const StudyMaterial = mongoose.model<IStudyMaterial>('StudyMaterial', studyMaterialSchema);
