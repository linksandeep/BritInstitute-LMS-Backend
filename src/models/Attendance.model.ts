import mongoose, { Document, Schema } from 'mongoose';

export interface IAttendance extends Document {
  liveClass: mongoose.Types.ObjectId;
  student: mongoose.Types.ObjectId;
  batch: mongoose.Types.ObjectId;
  status: 'present' | 'absent';
  markedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const attendanceSchema = new Schema<IAttendance>(
  {
    liveClass: { type: Schema.Types.ObjectId, ref: 'LiveClass', required: true },
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
    status: { type: String, enum: ['present', 'absent'], default: 'absent' },
    markedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One record per student per class
attendanceSchema.index({ liveClass: 1, student: 1 }, { unique: true });
attendanceSchema.index({ batch: 1, student: 1 });

export const Attendance = mongoose.model<IAttendance>('Attendance', attendanceSchema);
