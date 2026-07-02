import mongoose, { Document, Schema } from 'mongoose';
import { VideoType } from './RecordedLecture.model';

export interface FoundationChapter {
  start: number;
  title: string;
  text: string;
}

export interface FoundationTranscriptItem {
  start: number;
  speaker?: string;
  text: string;
}

export interface IFoundationResource extends Document {
  title: string;
  description: string;

  videoUrl: string;
  videoType: VideoType;

  // Zoom URLs
  zoomDownloadUrl?: string;
  zoomPlayUrl?: string;
  zoomShareUrl?: string;
  zoomTranscriptUrl?: string;
  zoomThumbnailUrl?: string;

  // Zoom Recording Metadata
  zoomRecordingMeetingId?: string;
  zoomRecordingFileId?: string;
  zoomRecordingUuid?: string;

  recordingSource?: string;
  recordingStatus?: string;

  recordingStartedAt?: Date;
  recordingCompletedAt?: Date;

  duration?: number;

  // AI / Transcript
  zoomSummary?: string;
  zoomChapters?: FoundationChapter[];
  zoomTranscript?: FoundationTranscriptItem[];

  playbackMode?: 'protected_stream' | 'public_zoom';

  order: number;

  uploadedBy: mongoose.Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const foundationResourceSchema = new Schema<IFoundationResource>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: '',
    },

    videoUrl: {
      type: String,
      required: true,
      trim: true,
    },

    videoType: {
      type: String,
      enum: ['youtube', 'drive', 'google_meet', 'zoom', 'other'],
      default: 'other',
    },

    // ==========================
    // Zoom URLs
    // ==========================

    zoomDownloadUrl: {
      type: String,
      default: '',
    },

    zoomPlayUrl: {
      type: String,
      default: '',
    },

    zoomShareUrl: {
      type: String,
      default: '',
    },

    zoomTranscriptUrl: {
      type: String,
      default: '',
    },

    zoomThumbnailUrl: {
      type: String,
      default: '',
    },

    // ==========================
    // Zoom Metadata
    // ==========================

    zoomRecordingMeetingId: {
      type: String,
      default: '',
    },

    zoomRecordingFileId: {
      type: String,
      default: '',
    },

    zoomRecordingUuid: {
      type: String,
      default: '',
    },

    recordingSource: {
      type: String,
      default: 'manual',
    },

    recordingStatus: {
      type: String,
      default: 'pending',
    },

    recordingStartedAt: {
      type: Date,
    },

    recordingCompletedAt: {
      type: Date,
    },

    duration: {
      type: Number,
      default: 0,
    },

    playbackMode: {
      type: String,
      enum: ['protected_stream', 'public_zoom'],
      default: 'protected_stream',
    },

    // ==========================
    // AI Summary
    // ==========================

    zoomSummary: {
      type: String,
      default: '',
    },

    zoomChapters: [
      {
        start: {
          type: Number,
          default: 0,
        },
        title: {
          type: String,
          default: '',
        },
        text: {
          type: String,
          default: '',
        },
      },
    ],

    zoomTranscript: [
      {
        start: {
          type: Number,
          default: 0,
        },
        speaker: {
          type: String,
          default: '',
        },
        text: {
          type: String,
          default: '',
        },
      },
    ],

    order: {
      type: Number,
      default: 0,
    },

    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// ==========================
// Indexes
// ==========================

foundationResourceSchema.index({
  order: 1,
  createdAt: -1,
});

foundationResourceSchema.index({
  videoType: 1,
});

foundationResourceSchema.index({
  recordingStatus: 1,
});

foundationResourceSchema.index({
  zoomRecordingMeetingId: 1,
});

foundationResourceSchema.index({
  zoomRecordingUuid: 1,
});

foundationResourceSchema.index({
  playbackMode: 1,
});

export const FoundationResource = mongoose.model<IFoundationResource>(
  'FoundationResource',
  foundationResourceSchema
);