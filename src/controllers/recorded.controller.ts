import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { Readable } from 'stream';
import { AuthRequest } from '../middleware/auth.middleware';
import { RecordedLecture, VideoType } from '../models/RecordedLecture.model';
import { LectureProgress } from '../models/LectureProgress.model';
import { Batch } from '../models/Batch.model';
import { User } from '../models/User.model';
import { config } from '../config/env';
import { fetchZoomRecordingFile, ZoomApiError } from '../services/zoom.service';
import { syncPendingZoomRecordings, syncZoomRecordingForLiveClass } from '../services/recordedLectureSync.service';
import { LiveClass } from '../models/LiveClass.model';

type RequestUser = NonNullable<AuthRequest['user']>;
type PlaybackMode = 'protected_stream' | 'blocked_external';
type StreamTokenPayload = {
  id: string;
  role: RequestUser['role'];
  username: string;
  lectureId: string;
  purpose: 'recorded-stream';
};

const staffRoles = ['teacher', 'admin', 'superadmin'];
const isDirectVideoUrl = (url: string) => /\.(mp4|webm|ogg)(?:$|[?#])/i.test(url);
const streamableResponseHeaders = ['content-length', 'content-range', 'accept-ranges'] as const;
const videoTypes: VideoType[] = ['youtube', 'drive', 'google_meet', 'zoom', 'other'];

const getBearerToken = (req: AuthRequest): string | null => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.split(' ')[1];
  return typeof req.query.token === 'string' ? req.query.token : null;
};

const resolveRequestUser = async (req: AuthRequest): Promise<RequestUser | null> => {
  if (req.user) return req.user;

  const token = getBearerToken(req);
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as RequestUser;
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) return null;
    return { id: decoded.id, role: decoded.role, username: decoded.username };
  } catch {
    return null;
  }
};

const resolveStreamTokenUser = async (req: AuthRequest): Promise<RequestUser | null> => {
  const token = typeof req.query.streamToken === 'string' ? req.query.streamToken : null;
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as StreamTokenPayload;
    if (decoded.purpose !== 'recorded-stream' || decoded.lectureId !== req.params.id) return null;
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) return null;
    return { id: decoded.id, role: decoded.role, username: decoded.username };
  } catch {
    return null;
  }
};

const createStreamToken = (lectureId: string, user: RequestUser): string =>
  jwt.sign(
    {
      id: user.id,
      role: user.role,
      username: user.username,
      lectureId,
      purpose: 'recorded-stream',
    },
    config.jwtSecret,
    { expiresIn: '4h' }
  );

const canAccessLecture = async (lecture: { batch: unknown }, user: RequestUser): Promise<boolean> => {
  if (staffRoles.includes(user.role)) return true;

  const batch = await Batch.exists({
    _id: lecture.batch,
    students: user.id,
    isActive: true,
  });

  return Boolean(batch);
};

const toClientLecture = (lecture: { toObject: () => any }) => {
  const data = lecture.toObject();
  const isZoomRecording = data.recordingSource === 'zoom';
  return {
    ...data,
    isPlayable: !isZoomRecording || (data.recordingStatus === 'available' && Boolean(data.zoomDownloadUrl)),
  };
};

const toStudentLecture = (lecture: { toObject: () => any }) => {
  const data = toClientLecture(lecture);
  const isZoomRecording = data.recordingSource === 'zoom';
  const canUseProtectedStream = isZoomRecording || isDirectVideoUrl(String(data.videoUrl || ''));
  const playbackMode: PlaybackMode = canUseProtectedStream ? 'protected_stream' : 'blocked_external';
  const shouldHideSourceUrl = canUseProtectedStream || data.recordingSource === 'zoom';

  return {
    ...data,
    playbackMode,
    isPlayable: data.isPlayable && (canUseProtectedStream || data.recordingSource === 'manual'),
    videoUrl: shouldHideSourceUrl ? '' : data.videoUrl,
  };
};

const getVideoType = (value: unknown): VideoType => {
  const type = String(value || 'other');
  return videoTypes.includes(type as VideoType) ? type as VideoType : 'other';
};

const getCleanString = (value: unknown) => String(value || '').trim();

export const createRecordedLecture = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { batch, title, description, videoUrl, videoType, order } = req.body;
    if (!batch || !title || !videoUrl) {
      res.status(400).json({ success: false, message: 'Batch, title and videoUrl are required' });
      return;
    }
    const lecture = await RecordedLecture.create({
      batch, title, description: description || '', videoUrl, videoType: videoType || 'other',
      recordingSource: 'manual',
      recordingStatus: 'available',
      order: order || 0, uploadedBy: req.user!.id,
    });
    res.status(201).json({ success: true, lecture });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getLecturesByBatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lectures = await RecordedLecture.find({ batch: req.params.batchId }).sort({ order: 1, createdAt: -1 });
    res.json({ success: true, lectures: lectures.map(toClientLecture) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getStudentLectures = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const batches = await Batch.find({ students: req.user!.id, isActive: true });
    const batchIds = batches.map(b => b._id);
    const lectures = await RecordedLecture.find({
      batch: { $in: batchIds },
      $or: [
        { liveClass: { $exists: false } },
        { liveClass: null },
        { recordingSource: 'manual' },
        { recordingStatus: 'available' },
        { recordingSource: 'zoom', recordingStatus: 'pending' },
      ],
    })
      .populate('liveClass', 'status scheduledAt duration')
      .sort({ order: 1, createdAt: -1 });

    const now = Date.now();
    const visibleLectures = lectures.filter((lecture) => {
      if (lecture.recordingSource !== 'zoom' || lecture.recordingStatus === 'available') return true;

      const liveClass = lecture.liveClass as unknown as { status?: string; scheduledAt?: Date; duration?: number } | null;
      if (!liveClass) return false;

      const scheduledAt = liveClass.scheduledAt ? new Date(liveClass.scheduledAt).getTime() : 0;
      const duration = Number(liveClass.duration) || 0;
      const endedByTime = scheduledAt > 0 && scheduledAt + duration * 60 * 1000 < now;

      return liveClass.status === 'ended' || endedByTime;
    });

    const enriched = await Promise.all(
      visibleLectures.map(async (lec) => {
        const prog = await LectureProgress.findOne({ lecture: lec._id, student: req.user!.id });
        return {
          ...toStudentLecture(lec),
          isCompleted: prog ? prog.isCompleted : false,
          watchDuration: prog ? prog.watchDuration : 0,
        };
      })
    );
    res.json({ success: true, lectures: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const updateProgress = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params; // lecture ID
    const { watchDuration, isCompleted, playbackPosition } = req.body;
    const student = req.user!.id;

    const lecture = await RecordedLecture.findById(id);
    if (!lecture) {
      res.status(404).json({ success: false, message: 'Lecture not found' });
      return;
    }

    const hasAccess = await canAccessLecture(lecture, req.user!);
    if (!hasAccess) {
      res.status(403).json({ success: false, message: 'You do not have access to this recorded lecture' });
      return;
    }

    const nextPosition = Number(playbackPosition);
    const progressSet: Record<string, unknown> = { lecture: id, student, batch: lecture.batch };
    if (Number.isFinite(nextPosition) && nextPosition >= 0) {
      progressSet.lastPosition = nextPosition;
    }

    const prog = await LectureProgress.findOneAndUpdate(
      { lecture: id, student },
      {
        $set: progressSet,
        $max: { watchDuration: watchDuration || 0 }
      },
      { upsert: true, new: true }
    );

    if (isCompleted && !prog.isCompleted) {
       prog.isCompleted = true;
       await prog.save();
    }

    res.json({ success: true, progress: prog });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const getAllLectures = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lectures = await RecordedLecture.find().populate('batch', 'name').sort({ createdAt: -1 });
    res.json({ success: true, lectures: lectures.map(toClientLecture) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const syncZoomRecordings = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await syncPendingZoomRecordings();
    res.json({
      success: true,
      message: `Checked ${result.checked} Zoom class${result.checked === 1 ? '' : 'es'} and imported ${result.imported} recording${result.imported === 1 ? '' : 's'}.`,
      ...result,
    });
  } catch (err) {
    const message = err instanceof ZoomApiError ? err.message : 'Unable to sync Zoom recordings';
    res.status(err instanceof ZoomApiError ? 502 : 500).json({ success: false, message });
  }
};

export const issueStreamToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    let lecture = await RecordedLecture.findById(req.params.id);
    if (!lecture) {
      res.status(404).json({ success: false, message: 'Lecture not found' });
      return;
    }

    const hasAccess = await canAccessLecture(lecture, req.user!);
    if (!hasAccess) {
      res.status(403).json({ success: false, message: 'You do not have access to this recorded lecture' });
      return;
    }

    if (lecture.recordingSource !== 'zoom' && lecture.videoType === 'zoom' && lecture.liveClass) {
      const liveClass = await LiveClass.findById(lecture.liveClass);
      if (liveClass) {
        await syncZoomRecordingForLiveClass(liveClass);
        lecture = await RecordedLecture.findById(req.params.id);
        if (!lecture) {
          res.status(404).json({ success: false, message: 'Lecture not found' });
          return;
        }
      }
    }

    const isStreamable = lecture.recordingSource === 'zoom' || isDirectVideoUrl(lecture.videoUrl);
    if (!isStreamable) {
      res.status(409).json({ success: false, message: 'This recording cannot be played in protected LMS mode.' });
      return;
    }

    res.json({ success: true, streamToken: createStreamToken(String(lecture._id), req.user!), expiresInSeconds: 14400 });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Unable to prepare protected playback' });
  }
};

export const streamLecture = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveStreamTokenUser(req);
    if (!user) {
      res.status(401).json({ success: false, message: 'Not authorized' });
      return;
    }

    const lecture = await RecordedLecture.findById(req.params.id);
    if (!lecture) {
      res.status(404).json({ success: false, message: 'Lecture not found' });
      return;
    }

    const hasAccess = await canAccessLecture(lecture, user);
    if (!hasAccess) {
      res.status(403).json({ success: false, message: 'You do not have access to this recorded lecture' });
      return;
    }

    if (lecture.recordingSource === 'zoom') {
      if (lecture.recordingStatus !== 'available') {
        res.status(409).json({ success: false, message: 'Zoom recording is still processing' });
        return;
      }

      if (!lecture.zoomDownloadUrl) {
        res.status(409).json({ success: false, message: 'Zoom recording is still processing' });
        return;
      }

      const zoomResponse = await fetchZoomRecordingFile(lecture.zoomDownloadUrl, req.headers.range);
      res.status(zoomResponse.status);

      for (const header of streamableResponseHeaders) {
        const value = zoomResponse.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      if (!zoomResponse.body) {
        res.status(502).json({ success: false, message: 'Zoom recording stream is empty' });
        return;
      }

      Readable.fromWeb(zoomResponse.body as never).pipe(res);
      return;
    }

    if (!isDirectVideoUrl(lecture.videoUrl)) {
      res.status(409).json({
        success: false,
        message: 'This recording is hosted by an external provider and cannot be protected by LMS streaming.',
      });
      return;
    }

    const upstreamResponse = await fetch(lecture.videoUrl, {
      headers: req.headers.range ? { Range: req.headers.range } : undefined,
    });

    if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
      res.status(502).json({ success: false, message: 'Unable to stream recorded lecture' });
      return;
    }

    res.status(upstreamResponse.status);
    for (const header of streamableResponseHeaders) {
      const value = upstreamResponse.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader('Content-Type', upstreamResponse.headers.get('content-type') || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (!upstreamResponse.body) {
      res.status(502).json({ success: false, message: 'Recording stream is empty' });
      return;
    }

    Readable.fromWeb(upstreamResponse.body as never).pipe(res);
  } catch (err) {
    const message = err instanceof ZoomApiError ? err.message : 'Unable to stream recorded lecture';
    res.status(err instanceof ZoomApiError ? 502 : 500).json({ success: false, message });
  }
};

export const updateLecture = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lecture = await RecordedLecture.findById(req.params.id);
    if (!lecture) {
      res.status(404).json({ success: false, message: 'Lecture not found' });
      return;
    }

    if (req.body.batch !== undefined) lecture.batch = req.body.batch;
    if (req.body.title !== undefined) {
      const title = getCleanString(req.body.title);
      if (!title) {
        res.status(400).json({ success: false, message: 'Lecture title is required' });
        return;
      }
      lecture.title = title;
    }
    if (req.body.description !== undefined) lecture.description = getCleanString(req.body.description);
    if (req.body.videoType !== undefined) lecture.videoType = getVideoType(req.body.videoType);
    if (req.body.order !== undefined) {
      const order = Number(req.body.order);
      lecture.order = Number.isFinite(order) ? order : 0;
    }

    if (req.body.videoUrl !== undefined) {
      const videoUrl = getCleanString(req.body.videoUrl);
      if (!videoUrl) {
        res.status(400).json({ success: false, message: 'Video URL is required' });
        return;
      }

      const replacingRecording = videoUrl !== lecture.videoUrl || req.body.replaceRecording === true;
      lecture.videoUrl = videoUrl;

      if (replacingRecording) {
        lecture.recordingSource = 'manual';
        lecture.recordingStatus = 'available';
        lecture.zoomRecordingFileId = undefined;
        lecture.zoomRecordingMeetingId = undefined;
        lecture.zoomDownloadUrl = undefined;
        lecture.zoomPlayUrl = undefined;
        lecture.zoomShareUrl = undefined;
        lecture.recordingStartedAt = undefined;
        lecture.recordingCompletedAt = undefined;
      }
    }

    await lecture.save();
    res.json({ success: true, lecture: toClientLecture(lecture) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const deleteLecture = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lecture = await RecordedLecture.findByIdAndDelete(req.params.id);
    if (!lecture) {
      res.status(404).json({ success: false, message: 'Lecture not found' });
      return;
    }
    res.json({ success: true, message: 'Lecture deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};
