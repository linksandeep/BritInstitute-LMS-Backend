import mongoose, { Document, Schema } from 'mongoose';

export interface IUserSession extends Document {
  user: mongoose.Types.ObjectId;
  role: 'superadmin' | 'admin' | 'teacher' | 'student';
  loginAt: Date;
  logoutAt?: Date;
  lastActiveAt: Date;
  durationSeconds: number;
  status: 'active' | 'logged_out' | 'expired';
  logoutReason?: 'manual' | 'inactivity' | 'expired' | 'replaced';
  userAgent?: string;
  ipAddress?: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSessionSchema = new Schema<IUserSession>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['superadmin', 'admin', 'teacher', 'student'], required: true, index: true },
    loginAt: { type: Date, required: true, default: Date.now, index: true },
    logoutAt: { type: Date },
    lastActiveAt: { type: Date, required: true, default: Date.now, index: true },
    durationSeconds: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['active', 'logged_out', 'expired'], default: 'active', index: true },
    logoutReason: { type: String, enum: ['manual', 'inactivity', 'expired', 'replaced'] },
    userAgent: { type: String, default: '' },
    ipAddress: { type: String, default: '' },
  },
  { timestamps: true }
);

userSessionSchema.index({ user: 1, loginAt: -1 });
userSessionSchema.index({ role: 1, loginAt: -1 });

export const UserSession = mongoose.model<IUserSession>('UserSession', userSessionSchema);
