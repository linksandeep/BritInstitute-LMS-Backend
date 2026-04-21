import mongoose, { Document, Schema } from 'mongoose';

export interface IBooking extends Document {
  student: mongoose.Types.ObjectId;
  mentor: mongoose.Types.ObjectId;
  topic: string;
  dateTime: Date;
  duration: number; // in minutes
  status: 'pending' | 'accepted' | 'completed' | 'cancelled';
  meetingLink?: string;
  createdAt: Date;
  updatedAt: Date;
}

const bookingSchema = new Schema<IBooking>(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mentor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    topic: { type: String, required: true, trim: true },
    dateTime: { type: Date, required: true },
    duration: { type: Number, default: 30 },
    status: { 
      type: String, 
      enum: ['pending', 'accepted', 'completed', 'cancelled'], 
      default: 'pending' 
    },
    meetingLink: { type: String },
  },
  { timestamps: true }
);

export const Booking = mongoose.model<IBooking>('Booking', bookingSchema);
