import mongoose, { Document, Schema } from 'mongoose';

export interface ISoftwareLicense extends Document {
  license: string;
  issuedAt: Date;
  expiresAt: Date;
  lastEmergencyUnlockAt?: Date;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const softwareLicenseSchema = new Schema<ISoftwareLicense>(
  {
    license: { type: String, required: true, trim: true },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    lastEmergencyUnlockAt: { type: Date },
    note: { type: String, trim: true },
  },
  { timestamps: true, collection: 'licenc' }
);
