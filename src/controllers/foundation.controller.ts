import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { Readable } from 'stream';
import { AuthRequest } from '../middleware/auth.middleware';
import { FoundationResource, IFoundationResource } from '../models/FoundationResource.model';
import { VideoType } from '../models/RecordedLecture.model';
import { config } from '../config/env';
import {
  fetchZoomRecordingFile,
  fetchZoomPublicRecordingFile,
  fetchZoomTextFile,
  findZoomRecordingByUrl,
  pickBestZoomRecordingFile,
  pickZoomTranscriptFile,
  ZoomApiError,
  ZoomRecordingsResponse,
} from '../services/zoom.service';

const videoTypes: VideoType[] = ['youtube', 'drive', 'google_meet', 'zoom', 'other'];
const streamableResponseHeaders = ['content-length', 'content-range', 'accept-ranges'] as const;
const isDirectVideoUrl = (url: string) => /\.(mp4|webm|ogg)(?:$|[?#])/i.test(url);
const isZoomDownloadUrl = (url: string) => /zoom\.us\/rec\/download\//i.test(url) || /[?&]download=1/i.test(url);
const isZoomApiDownloadUrl = (url: string) => /api\.zoom\.us\/rec\/download\//i.test(url);
const isZoomPublicVideoUrl = (url: string) => /(^|\.)zoom\.us\//i.test(url) && isDirectVideoUrl(url);

const getZoomPublicDownloadUrl = (sourceUrl: string): string => {
  if (!/zoom\.us\/rec\/share\//i.test(sourceUrl)) return '';

  try {
    const parsed = new URL(sourceUrl);
    parsed.pathname = parsed.pathname.replace(/\/rec\/share\//i, '/rec/download/');
    parsed.searchParams.delete('from');
    return parsed.toString();
  } catch {
    return sourceUrl.replace(/\/rec\/share\//i, '/rec/download/').replace(/[?&]from=hub\b/i, '');
  }
};

const fetchPublicRecordingFile = (url: string, range?: string): Promise<globalThis.Response> =>
  fetch(url, {
    redirect: 'follow',
    headers: {
      ...(range ? { Range: range } : {}),
      'User-Agent': 'Mozilla/5.0 BritInstituteLMS/1.0',
    },
  });

const isVideoResponse = (response: globalThis.Response): boolean => {
  const contentType = response.headers.get('content-type') || '';
  return /video\/|application\/octet-stream/i.test(contentType);
};

const isPlayablePublicRecordingUrl = async (url: string): Promise<boolean> => {
  try {
    const response = await fetchPublicRecordingFile(url, 'bytes=0-0');
    return (response.ok || response.status === 206) && isVideoResponse(response);
  } catch {
    return false;
  }
};

const getVideoType = (value: unknown): VideoType => {
  const type = String(value || 'other');
  return videoTypes.includes(type as VideoType) ? type as VideoType : 'other';
};

const getCleanString = (value: unknown) => String(value || '').trim();

const parseVttTime = (value: string): number => {
  const parts = value.trim().split(':').map(Number);
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  return 0;
};

const parseZoomTranscript = (transcript: string) => {
  const cues = transcript
    .replace(/\r/g, '')
    .split('\n\n')
    .map((block) => {
      const lines = block.split('\n').filter(Boolean);
      const timeLine = lines.find((line) => line.includes('-->'));
      if (!timeLine) return null;
      const text = lines
        .slice(lines.indexOf(timeLine) + 1)
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) return null;
      return { start: parseVttTime(timeLine.split('-->')[0]), text };
    })
    .filter((cue): cue is { start: number; text: string } => Boolean(cue));

  const fullText = cues.map((cue) => cue.text).join(' ').replace(/\s+/g, ' ').trim();
  const chapters = cues.filter((_, index) => index % 12 === 0).slice(0, 8).map((cue, index) => ({
    start: cue.start,
    title: index === 0 ? 'Introduction' : `Chapter ${index + 1}`,
    text: cue.text.slice(0, 160),
  }));

  return {
    summary: fullText.slice(0, 700),
    chapters,
  };
};

const parseZoomTimestamp = (value: string): number => {
  const parts = value.split(':');
  if (parts.length === 3) {
    return (Number(parts[0]) * 3600) + (Number(parts[1]) * 60) + Number.parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return (Number(parts[0]) * 60) + Number.parseFloat(parts[1]);
  }
  return Number.parseFloat(value) || 0;
};

const importPublicZoomTranscript = (
  resource: IFoundationResource,
  recording: ZoomRecordingsResponse
): void => {
  const transcript = (recording.publicTranscriptList || [])
    .map((item) => ({
      start: parseZoomTimestamp(String(item.ts || '0')),
      speaker: String(item.username || ''),
      text: String(item.text || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((item) => item.text);

  if (transcript.length === 0) return;

  resource.zoomTranscript = transcript;
  resource.zoomSummary = transcript
    .slice(0, 16)
    .map((item) => item.text)
    .join(' ')
    .slice(0, 700);

  const highlightStarts = (() => {
    try {
      return (JSON.parse(recording.publicHighlightRanges || '[]') as { startTime?: string }[])
        .map((range) => parseZoomTimestamp(String(range.startTime || '')))
        .filter((start) => Number.isFinite(start) && start > 0);
    } catch {
      return [];
    }
  })();

  const chapterStarts = (highlightStarts.length > 0
    ? highlightStarts
    : transcript.filter((_, index) => index % 20 === 0).map((item) => item.start)
  ).slice(0, 8);

  resource.zoomChapters = chapterStarts.map((start, index) => {
    const cue = transcript.find((item) => item.start >= start) || transcript[0];
    return {
      start,
      title: index === 0 ? 'Introduction' : `Chapter ${index + 1}`,
      text: cue.text.slice(0, 160),
    };
  });
};

const persistZoomHydration = async (resource: IFoundationResource): Promise<void> => {
  await FoundationResource.findByIdAndUpdate(resource._id, {
    $set: {
      zoomDownloadUrl: resource.zoomDownloadUrl,
      zoomPlayUrl: resource.zoomPlayUrl,
      zoomShareUrl: resource.zoomShareUrl,
      zoomTranscriptUrl: resource.zoomTranscriptUrl,
      zoomThumbnailUrl: resource.zoomThumbnailUrl,
      zoomRecordingMeetingId: resource.zoomRecordingMeetingId,
      zoomRecordingUuid: resource.zoomRecordingUuid,
      zoomRecordingFileId: resource.zoomRecordingFileId,
      zoomSummary: resource.zoomSummary,
      zoomChapters: resource.zoomChapters,
      zoomTranscript: resource.zoomTranscript,
      recordingSource: resource.recordingSource,
      recordingStatus: resource.recordingStatus,
      recordingStartedAt: resource.recordingStartedAt,
      recordingCompletedAt: resource.recordingCompletedAt,
      duration: resource.duration,
    },
  });
};

const hydrateZoomFoundationResource = async (
  resource: IFoundationResource | null
): Promise<void> => {
  if (!resource) {
    console.log("[Zoom] Resource is null");
    return;
  }

  if (resource.videoType !== "zoom") {
    console.log("[Zoom] Not a Zoom resource");
    return;
  }

  if (resource.zoomDownloadUrl) {
    if (!isZoomDownloadUrl(resource.zoomDownloadUrl) && !isZoomPublicVideoUrl(resource.zoomDownloadUrl)) {
      console.log("[Zoom] Already hydrated");
      return;
    }

    const isPlayable = await isPlayablePublicRecordingUrl(resource.zoomDownloadUrl);
    if (isPlayable) {
      console.log("[Zoom] Already hydrated");
      return;
    }

    console.warn("[Zoom] Existing public download URL returned non-video content. Clearing it.");
    resource.zoomDownloadUrl = "";
    resource.recordingStatus = "pending";
  }

  console.log("========================================");
  console.log("[Zoom] Starting hydration");
  console.log("[Zoom] Resource:", resource._id.toString());
  console.log("[Zoom] Video URL:", resource.videoUrl);

  let recording: ZoomRecordingsResponse | null = null;

  try {
    recording = await findZoomRecordingByUrl(resource.videoUrl);
  } catch (err) {
    console.error("[Zoom] Failed to find recording:", err);
  }

  if (!recording) {
    const publicDownloadUrl = getZoomPublicDownloadUrl(resource.videoUrl);
    if (!publicDownloadUrl) {
      console.error("[Zoom] ❌ Recording not found");
      return;
    }

    const isPlayable = await isPlayablePublicRecordingUrl(publicDownloadUrl);
    if (!isPlayable) {
      console.error("[Zoom] Public rec/download fallback returned non-video content.");
      return;
    }

    console.warn("[Zoom] API recording not found. Using public rec/download fallback.");
    resource.zoomDownloadUrl = publicDownloadUrl;
    resource.zoomPlayUrl = resource.videoUrl;
    resource.zoomShareUrl = resource.videoUrl;
    resource.recordingSource = "zoom";
    resource.recordingStatus = "available";
    await persistZoomHydration(resource);
    return;
  }

  console.log("[Zoom] Recording found");

  const bestFile = pickBestZoomRecordingFile(recording);

  if (!bestFile) {
    const publicDownloadUrl = getZoomPublicDownloadUrl(resource.videoUrl);
    if (!publicDownloadUrl) {
      console.error("[Zoom] ❌ No MP4 recording found");
      console.log(recording.recording_files);
      return;
    }

    const isPlayable = await isPlayablePublicRecordingUrl(publicDownloadUrl);
    if (!isPlayable) {
      console.error("[Zoom] Public rec/download fallback returned non-video content.");
      return;
    }

    console.warn("[Zoom] API recording has no MP4. Using public rec/download fallback.");
    resource.zoomDownloadUrl = publicDownloadUrl;
    resource.zoomPlayUrl = resource.videoUrl;
    resource.zoomShareUrl = recording.share_url || resource.videoUrl;
    resource.recordingSource = "zoom";
    resource.recordingStatus = "available";
    await persistZoomHydration(resource);
    return;
  }

  // -----------------------------
  // Save URLs
  // -----------------------------

  resource.zoomDownloadUrl = bestFile.download_url || "";
  resource.zoomPlayUrl = bestFile.play_url || "";
  resource.zoomShareUrl = recording.share_url || resource.videoUrl;

  // -----------------------------
  // Recording Metadata
  // -----------------------------

  resource.zoomRecordingMeetingId = recording.id
    ? String(recording.id)
    : "";

  resource.zoomRecordingUuid = recording.uuid || "";

  resource.zoomRecordingFileId = bestFile.id || "";

  resource.recordingSource = "zoom";
  resource.recordingStatus = "available";
  resource.duration = recording.publicDuration || resource.duration || 0;

  if (bestFile.recording_start) {
    resource.recordingStartedAt = new Date(bestFile.recording_start);
  }

  if (bestFile.recording_end) {
    resource.recordingCompletedAt = new Date(bestFile.recording_end);
  }

  // -----------------------------
  // Transcript
  // -----------------------------

  const transcriptFile = pickZoomTranscriptFile(recording);

  if (transcriptFile?.download_url) {
    resource.zoomTranscriptUrl = transcriptFile.download_url;

    try {
      const transcript = await fetchZoomTextFile(
        transcriptFile.download_url
      );

      const parsed = parseZoomTranscript(transcript);

      resource.zoomSummary = parsed.summary;
      resource.zoomChapters = parsed.chapters;

  

      console.log("[Zoom] Transcript imported");
    } catch (err) {
      console.error("[Zoom] Transcript parse failed:", err);
    }
  }

  importPublicZoomTranscript(resource, recording);

  await persistZoomHydration(resource);

  console.log("========================================");
  console.log("[Zoom] Foundation hydrated successfully");
  console.log("[Zoom] Download URL:", resource.zoomDownloadUrl);
  console.log("[Zoom] Meeting:", resource.zoomRecordingMeetingId);
  console.log("========================================");
};
const toClientResource = (resource: { toObject: () => any }) => {
  const data = resource.toObject();
  const canStream = Boolean(data.zoomDownloadUrl) || isDirectVideoUrl(String(data.videoUrl || '')) || isZoomDownloadUrl(String(data.videoUrl || ''));
  return {
    ...data,
    playbackMode: canStream ? 'protected_stream' : undefined,
    isPlayable: canStream || data.videoType !== 'zoom',
  };
};

const createFoundationStreamToken = (resourceId: string, user: NonNullable<AuthRequest['user']>): string =>
  jwt.sign(
    {
      id: user.id,
      role: user.role,
      username: user.username,
      resourceId,
      purpose: 'foundation-stream',
    },
    config.jwtSecret,
    { expiresIn: '4h' }
  );

const resolveFoundationStreamUser = async (req: AuthRequest) => {
  const token = typeof req.query.streamToken === 'string' ? req.query.streamToken : null;
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { id: string; resourceId: string; purpose: string };
    if (decoded.purpose !== 'foundation-stream' || decoded.resourceId !== req.params.id) return null;
    return decoded;
  } catch {
    return null;
  }
};




export const getFoundationResources = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const resources = await FoundationResource.find().sort({ order: 1, createdAt: -1 });
    res.json({ success: true, resources });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const createFoundationResource = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const title = getCleanString(req.body.title);
    const videoUrl = getCleanString(req.body.videoUrl);

    if (!title || !videoUrl) {
      return void res.status(400).json({
        success: false,
        message: "Title and video URL are required",
      });
    }

    const resource = await FoundationResource.create({
      title,
      description: getCleanString(req.body.description),
      videoUrl,
      videoType: getVideoType(req.body.videoType),
      order: Number.isFinite(Number(req.body.order))
        ? Number(req.body.order)
        : 0,
      uploadedBy: req.user!.id,
    });

    // Hydrate Zoom metadata if this is a Zoom recording
    if (resource.videoType === "zoom") {
      try {
        console.log("====================================");
        console.log("Creating Foundation Resource");
        console.log("Video URL:", resource.videoUrl);
        console.log("====================================");

        await hydrateZoomFoundationResource(resource);
      } catch (err) {
        console.error(
          "[Foundation] Failed to hydrate Zoom resource:",
          err
        );
      }
    }

    // Return latest version from MongoDB
    const latest = await FoundationResource.findById(resource._id);

    res.status(201).json({
      success: true,
      resource: latest || resource,
    });
  } catch (err) {
    console.error("createFoundationResource:", err);

    res.status(500).json({
      success: false,
      message:
        err instanceof Error ? err.message : "Internal Server Error",
    });
  }
};
export const updateFoundationResource = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const resource = await FoundationResource.findById(req.params.id);
    if (!resource) {
      res.status(404).json({ success: false, message: 'Foundation resource not found' });
      return;
    }

    if (req.body.title !== undefined) {
      const title = getCleanString(req.body.title);
      if (!title) {
        res.status(400).json({ success: false, message: 'Title is required' });
        return;
      }
      resource.title = title;
    }
    const previousVideoUrl = resource.videoUrl;
    const previousVideoType = resource.videoType;

    if (req.body.videoUrl !== undefined) {
      const videoUrl = getCleanString(req.body.videoUrl);
      if (!videoUrl) {
        res.status(400).json({ success: false, message: 'Video URL is required' });
        return;
      }
      resource.videoUrl = videoUrl;
    }
    if (req.body.description !== undefined) resource.description = getCleanString(req.body.description);
    if (req.body.videoType !== undefined) resource.videoType = getVideoType(req.body.videoType);
    if (req.body.order !== undefined) {
      const order = Number(req.body.order);
      resource.order = Number.isFinite(order) ? order : 0;
    }

    const zoomSourceChanged = previousVideoUrl !== resource.videoUrl || previousVideoType !== resource.videoType;
    if (zoomSourceChanged) {
      resource.zoomDownloadUrl = '';
      resource.zoomPlayUrl = '';
      resource.zoomShareUrl = '';
      resource.zoomTranscriptUrl = '';
      resource.zoomThumbnailUrl = '';
      resource.zoomRecordingMeetingId = '';
      resource.zoomRecordingFileId = '';
      resource.zoomRecordingUuid = '';
      resource.recordingSource = resource.videoType === 'zoom' ? 'zoom' : 'manual';
      resource.recordingStatus = resource.videoType === 'zoom' ? 'pending' : 'available';
      resource.recordingStartedAt = undefined;
      resource.recordingCompletedAt = undefined;
      resource.duration = 0;
      resource.zoomSummary = '';
      resource.zoomChapters = [];
      resource.zoomTranscript = [];
    }

    await resource.save();

    if (resource.videoType === 'zoom') {
      await hydrateZoomFoundationResource(resource);
    }

    const latest = await FoundationResource.findById(resource._id);
    res.json({ success: true, resource: latest || resource });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};



export const issueFoundationStreamToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const resource = await FoundationResource.findById(req.params.id);
    if (!resource) {
      res.status(404).json({ success: false, message: 'Foundation resource not found' });
      return;
    }

    await hydrateZoomFoundationResource(resource);

    if (!resource.zoomDownloadUrl && !isDirectVideoUrl(resource.videoUrl) && !isZoomDownloadUrl(resource.videoUrl)) {
      res.status(409).json({
        success: false,
        message: resource.videoType === 'zoom'
          ? 'Zoom did not return an MP4 file for this Foundation recording. Use a Zoom cloud recording from the connected Zoom account, or paste the Zoom recording download link instead of the Zoom play/share page.'
          : 'This Foundation recording is not ready for native LMS playback yet.',
      });
      return;
    }

    res.json({
      success: true,
      streamToken: createFoundationStreamToken(String(resource._id), req.user!),
      expiresInSeconds: 14400,
      resource: toClientResource(resource),
    });
  } catch (err) {
    const message = err instanceof ZoomApiError ? err.message : 'Unable to prepare Foundation playback';
    res.status(err instanceof ZoomApiError ? 502 : 500).json({ success: false, message });
  }
};

export const streamFoundationResource = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveFoundationStreamUser(req);
    if (!user) {
      res.status(401).json({ success: false, message: 'Not authorized' });
      return;
    }

    const resource = await FoundationResource.findById(req.params.id);
    if (!resource) {
      res.status(404).json({ success: false, message: 'Foundation resource not found' });
      return;
    }

    const sourceUrl = resource.zoomDownloadUrl || resource.videoUrl;
    if (!resource.zoomDownloadUrl && !isDirectVideoUrl(sourceUrl) && !isZoomDownloadUrl(sourceUrl)) {
      res.status(409).json({ success: false, message: 'This Foundation recording is not ready for native LMS playback yet.' });
      return;
    }

    let upstreamResponse: globalThis.Response;

    if (resource.videoType === 'zoom' && resource.videoUrl) {
      const recording = await findZoomRecordingByUrl(resource.videoUrl);
      const bestFile = recording ? pickBestZoomRecordingFile(recording) : null;

      if (bestFile?.download_url) {
        upstreamResponse = bestFile.public_cookie_header
          ? await fetchZoomPublicRecordingFile(bestFile, req.headers.range)
          : isZoomApiDownloadUrl(bestFile.download_url)
            ? await fetchZoomRecordingFile(bestFile.download_url, req.headers.range)
            : await fetchPublicRecordingFile(bestFile.download_url, req.headers.range);
      } else if (resource.zoomDownloadUrl) {
        upstreamResponse = isZoomApiDownloadUrl(resource.zoomDownloadUrl)
          ? await fetchZoomRecordingFile(resource.zoomDownloadUrl, req.headers.range)
          : await fetchPublicRecordingFile(resource.zoomDownloadUrl, req.headers.range);
      } else {
        res.status(409).json({ success: false, message: 'This Foundation recording is not ready for native LMS playback yet.' });
        return;
      }
    } else if (resource.zoomDownloadUrl) {
      upstreamResponse = isZoomApiDownloadUrl(resource.zoomDownloadUrl)
        ? await fetchZoomRecordingFile(resource.zoomDownloadUrl, req.headers.range)
        : await fetchPublicRecordingFile(resource.zoomDownloadUrl, req.headers.range);
    } else {
      upstreamResponse = await fetch(sourceUrl, { headers: req.headers.range ? { Range: req.headers.range } : undefined });
    }

    if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
      res.status(502).json({ success: false, message: 'Unable to stream Foundation recording' });
      return;
    }

    if (!isVideoResponse(upstreamResponse)) {
      res.status(502).json({
        success: false,
        message: 'Zoom returned a web page instead of an MP4 video. Paste the Zoom recording download link or use a recording from the connected Zoom account so LMS can import the MP4 and transcript.',
      });
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
      res.status(502).json({ success: false, message: 'Foundation recording stream is empty' });
      return;
    }

    Readable.fromWeb(upstreamResponse.body as never).pipe(res);
  } catch (err) {
    const message = err instanceof ZoomApiError ? err.message : 'Unable to stream Foundation recording';
    res.status(err instanceof ZoomApiError ? 502 : 500).json({ success: false, message });
  }
};

export const deleteFoundationResource = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const resource = await FoundationResource.findByIdAndDelete(req.params.id);
    if (!resource) {
      res.status(404).json({ success: false, message: 'Foundation resource not found' });
      return;
    }
    res.json({ success: true, message: 'Foundation resource deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};
