import mongoose, { Document, Schema } from 'mongoose';

export interface ICurriculumTopic {
  _id?: mongoose.Types.ObjectId;
  title: string;
  duration: number;
  scheduledAt?: Date;
  meetingLink?: string;
  liveClassId?: mongoose.Types.ObjectId;
}

export interface ICurriculumModule {
  _id?: mongoose.Types.ObjectId;
  title: string;
  topics: ICurriculumTopic[];
}

export interface ICurriculum extends Document {
  title: string;
  course: mongoose.Types.ObjectId;
  batch?: mongoose.Types.ObjectId | null;
  modules: ICurriculumModule[];
  createdAt: Date;
  updatedAt: Date;
}

const curriculumTopicSchema = new Schema<ICurriculumTopic>(
  {
    title: { type: String, required: true, trim: true },
    duration: { type: Number, required: true, min: 1, default: 60 },
    scheduledAt: { type: Date },
    meetingLink: { type: String, trim: true },
    liveClassId: { type: Schema.Types.ObjectId, ref: 'LiveClass' },
  },
  { _id: true }
);

const curriculumModuleSchema = new Schema<ICurriculumModule>(
  {
    title: { type: String, required: true, trim: true },
    topics: { type: [curriculumTopicSchema], default: [] },
  },
  { _id: true }
);

const curriculumSchema = new Schema<ICurriculum>(
  {
    title: { type: String, required: true, trim: true },
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', default: null },
    modules: { type: [curriculumModuleSchema], default: [] },
  },
  { timestamps: true }
);

curriculumSchema.index({ batch: 1 }, { unique: true, partialFilterExpression: { batch: { $type: 'objectId' } } });
curriculumSchema.index({ course: 1, batch: 1 });

export const Curriculum = mongoose.model<ICurriculum>('Curriculum', curriculumSchema);
