import { config } from '../config/env';
import { formatUkMeetingRange, getUkZoomDateTimeValue, UK_TIME_ZONE } from '../utils/ukTime';

interface ZoomTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface ZoomMeetingResponse {
  id: number;
  uuid?: string;
  join_url: string;
  start_url: string;
}

export interface ZoomRecordingFile {
  id?: string;
  file_type?: string;
  file_extension?: string;
  file_size?: number;
  play_url?: string;
  download_url?: string;
  public_cookie_header?: string;
  public_referer?: string;
  status?: string;
  recording_type?: string;
  recording_start?: string;
  recording_end?: string;
}

export interface ZoomRecordingsResponse {
  id?: number | string;
  uuid?: string;
  topic?: string;
  share_url?: string;
  password?: string;
  recording_files?: ZoomRecordingFile[];
  publicTranscriptList?: {
    ts?: string;
    text?: string;
    username?: string;
    end_ts?: string;
  }[];
  publicHighlightRanges?: string;
  publicDuration?: number;
}

interface ZoomRecordingListResponse {
  meetings?: ZoomRecordingsResponse[];
  next_page_token?: string;
}

interface ZoomUserListResponse {
  users?: { id: string; email?: string }[];
  next_page_token?: string;
}

interface ZoomMeetingInput {
  topic: string;
  startTime: Date;
  duration: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export class ZoomApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ZoomApiError';
    this.status = status;
  }
}

const getZoomErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.text();
  if (!body) return fallback;

  try {
    const parsed = JSON.parse(body) as { message?: string; reason?: string; code?: number };
    const zoomMessage = parsed.message || parsed.reason;
    if (zoomMessage) return `Zoom error: ${zoomMessage}`;
  } catch {
    // Keep the plain-text body below.
  }

  return `Zoom error: ${body}`;
};

const ensureZoomConfig = (): void => {
  if (!config.zoom.accountId || !config.zoom.clientId || !config.zoom.clientSecret) {
    throw new ZoomApiError(
      'Zoom API credentials are not configured on the backend server. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET in production.',
      500
    );
  }
};

const getAccessToken = async (): Promise<string> => {
  ensureZoomConfig();

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const credentials = Buffer.from(`${config.zoom.clientId}:${config.zoom.clientSecret}`).toString('base64');
  const tokenUrl = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(config.zoom.accountId)}`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  });

  if (!response.ok) {
    const message = await getZoomErrorMessage(response, 'Unable to authenticate with Zoom. Please check Zoom credentials.');
    throw new ZoomApiError(message, response.status);
  }

  const data = (await response.json()) as ZoomTokenResponse;
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.token;
};

const getAuthorizedZoomHeaders = async (extraHeaders?: Record<string, string>): Promise<Record<string, string>> => {
  const token = await getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    ...(extraHeaders || {}),
  };
};

const encodeZoomMeetingIdentifier = (meetingId: string): string => {
  const encoded = encodeURIComponent(meetingId);
  return /[/?#]/.test(meetingId) ? encodeURIComponent(encoded) : encoded;
};

const normalizeZoomUrl = (value?: string): string => {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    parsed.searchParams.delete('pwd');
    parsed.searchParams.delete('passcode');
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return value.split('?')[0].replace(/\/$/, '').toLowerCase();
  }
};

const getZoomUrlParts = (value?: string): string[] => {
  if (!value) return [];
  try {
    const parsed = new URL(value);
    return parsed.pathname
      .split('/')
      .map((part) => decodeURIComponent(part).toLowerCase())
      .filter((part) => part.length >= 8);
  } catch {
    return value
      .split(/[/?#&=]+/)
      .map((part) => part.toLowerCase())
      .filter((part) => part.length >= 8);
  }
};

const recordingPriority = (file: ZoomRecordingFile): number => {
  const type = String(file.recording_type || '').toLowerCase();
  const extension = String(file.file_extension || file.file_type || '').toLowerCase();

  if (extension === 'mp4' && type.includes('shared_screen_with_speaker_view')) return 0;
  if (extension === 'mp4' && type.includes('shared_screen')) return 1;
  if (extension === 'mp4' && type.includes('active_speaker')) return 2;
  if (extension === 'mp4' && type.includes('gallery_view')) return 3;
  if (extension === 'mp4') return 4;
  return 10;
};
export const pickBestZoomRecordingFile = (
  recording: ZoomRecordingsResponse
): ZoomRecordingFile | null => {
  const recordingFiles = recording.recording_files || [];

  const files = recordingFiles
    .filter((file) => {
      const status = String(file.status || "").toLowerCase();

      const extension = String(
        file.file_extension ||
        file.file_type ||
        ""
      ).toLowerCase();

      // Skip files without download URL
      if (!file.download_url) {
        return false;
      }

      // Skip recordings still processing
      if (status && status !== "completed") {
        return false;
      }

      // Accept MP4 files only
      if (
        extension !== "mp4" &&
        !extension.includes("mp4")
      ) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      // Prefer recording type
      const priority =
        recordingPriority(a) - recordingPriority(b);

      if (priority !== 0) {
        return priority;
      }

      // Prefer larger files
      const sizeA = a.file_size || 0;
      const sizeB = b.file_size || 0;

      if (sizeA !== sizeB) {
        return sizeB - sizeA;
      }

      // Prefer newest recording
      const startA = new Date(
        a.recording_start || 0
      ).getTime();

      const startB = new Date(
        b.recording_start || 0
      ).getTime();

      return startB - startA;
    });

  if (files.length === 0) {
    return null;
  }

  return files[0];
};
export const pickZoomTranscriptFile = (recording: ZoomRecordingsResponse): ZoomRecordingFile | null =>
  (recording.recording_files || []).find((file) => {
    const type = String(file.file_type || file.recording_type || '').toLowerCase();
    const extension = String(file.file_extension || '').toLowerCase();
    return Boolean(file.download_url) && (extension === 'vtt' || type.includes('transcript') || type.includes('cc'));
  }) || null;

const getDateParam = (date: Date): string => date.toISOString().slice(0, 10);

const listZoomUsers = async (
  nextPageToken = ""
): Promise<ZoomUserListResponse> => {
  const params = new URLSearchParams({
    status: "active",
    page_size: "300",
  });

  if (nextPageToken) {
    params.set("next_page_token", nextPageToken);
  }

  const url = `https://api.zoom.us/v2/users?${params.toString()}`;

  console.log("======================================");
  console.log("[Zoom] Fetching Zoom users...");
  console.log("[Zoom] URL:", url);

  const response = await fetch(url, {
    method: "GET",
    headers: await getAuthorizedZoomHeaders(),
  });

  if (!response.ok) {
    const message = await getZoomErrorMessage(
      response,
      "Unable to fetch Zoom users."
    );

    console.error("[Zoom] Users API Error:", message);

    throw new ZoomApiError(message, response.status);
  }

  const data = (await response.json()) as ZoomUserListResponse;

  console.log(
    `[Zoom] Users returned: ${data.users?.length ?? 0}`
  );

  (data.users || []).forEach((user: any) => {
    console.log({
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      type: user.type,
      status: user.status,
    });
  });

  console.log("======================================");

  return data;
};

const getZoomRecordingUserIds = async (): Promise<string[]> => {
  const userIds = new Set<string>();

  let nextPageToken = "";

  do {
    try {
      const page = await listZoomUsers(nextPageToken);

      console.log("==================================");
      console.log("[Zoom] Users Returned:", page.users?.length ?? 0);

      (page.users || []).forEach((user: any) => {
        console.log({
          id: user.id,
          email: user.email,
          type: user.type,
          status: user.status,
        });

        if (user.id) {
          userIds.add(user.id);
        }
      });

      nextPageToken = page.next_page_token || "";
    } catch (err) {
      if (
        err instanceof ZoomApiError &&
        [401, 403, 404].includes(err.status)
      ) {
        break;
      }

      throw err;
    }
  } while (nextPageToken);

  // Always search the authenticated account too.
  userIds.add("me");

  console.log("[Zoom] Searching recordings for:");
  console.log(Array.from(userIds));

  console.log("==================================");

  return Array.from(userIds);
};

const listZoomRecordingsForRange = async (
  userId: string,
  from: Date,
  to: Date,
  nextPageToken = ""
): Promise<ZoomRecordingListResponse> => {
  const params = new URLSearchParams({
    from: getDateParam(from),
    to: getDateParam(to),
    page_size: "300",
  });

  if (nextPageToken) {
    params.set("next_page_token", nextPageToken);
  }

  const url = `https://api.zoom.us/v2/users/${encodeURIComponent(
    userId
  )}/recordings?${params.toString()}`;

  console.log("================================================");
  console.log("[Zoom] Fetching recordings");
  console.log("[Zoom] User ID:", userId);
  console.log("[Zoom] From:", getDateParam(from));
  console.log("[Zoom] To:", getDateParam(to));
  console.log("[Zoom] URL:", url);

  const response = await fetch(url, {
    method: "GET",
    headers: await getAuthorizedZoomHeaders(),
  });

  if (!response.ok) {
    const message = await getZoomErrorMessage(
      response,
      "Unable to fetch Zoom recordings."
    );

    console.error("[Zoom] API Error:", message);

    throw new ZoomApiError(message, response.status);
  }

  const data = (await response.json()) as ZoomRecordingListResponse;

  console.log(
    `[Zoom] Meetings returned: ${data.meetings?.length ?? 0}`
  );

  if (data.meetings?.length) {
    console.log("[Zoom] Recording List:");

    data.meetings.forEach((meeting) => {
      console.log({
        id: meeting.id,
        uuid: meeting.uuid,
        topic: meeting.topic,
        share_url: meeting.share_url,
        recording_files:
          meeting.recording_files?.length ?? 0,
      });

      if (meeting.recording_files?.length) {
        meeting.recording_files.forEach((file) => {
          console.log("   File:", {
            id: file.id,
            type: file.file_type,
            extension: file.file_extension,
            status: file.status,
            recording_type: file.recording_type,
            play_url: file.play_url,
            download_url: file.download_url,
          });
        });
      }
    });
  } else {
    console.log("[Zoom] No recordings returned for this date range.");
  }

  console.log("================================================");

  return data;
};

const zoomRecordingMatchesUrl = (
  recording: ZoomRecordingsResponse,
  sourceUrl: string
): boolean => {
  if (!sourceUrl) return false;

  const target = normalizeZoomUrl(sourceUrl);
  const targetLower = target.toLowerCase();
  const targetParts = getZoomUrlParts(sourceUrl);

  const candidates = [
    recording.share_url,
    ...(recording.recording_files || []).flatMap(file => [
      file.play_url,
      file.download_url,
    ]),
  ].filter(Boolean) as string[];

  // ---------- Exact URL Match ----------
  for (const candidateUrl of candidates) {
    const candidate = normalizeZoomUrl(candidateUrl);

    if (
      candidate === target ||
      candidate.includes(target) ||
      target.includes(candidate)
    ) {
      return true;
    }
  }

  // ---------- UUID Match ----------
  if (recording.uuid) {
    const uuid = decodeURIComponent(recording.uuid).toLowerCase();

    if (
      targetLower.includes(uuid) ||
      uuid.includes(targetLower)
    ) {
      return true;
    }
  }

  // ---------- Meeting ID Match ----------
  if (recording.id) {
    const meetingId = String(recording.id);

    if (
      target.includes(meetingId) ||
      sourceUrl.includes(meetingId)
    ) {
      return true;
    }
  }

  // ---------- Recording File ID Match ----------
  for (const file of recording.recording_files || []) {
    if (file.id && targetLower.includes(file.id.toLowerCase())) {
      return true;
    }
  }

  // ---------- Token Match ----------
  for (const candidateUrl of candidates) {
    const candidateParts = getZoomUrlParts(candidateUrl);

    let score = 0;

    for (const targetPart of targetParts) {
      if (
        candidateParts.some(candidatePart =>
          candidatePart === targetPart ||
          candidatePart.includes(targetPart) ||
          targetPart.includes(candidatePart)
        )
      ) {
        score++;
      }
    }

    // Require at least two matching tokens
    if (score >= 2) {
      return true;
    }
  }

  return false;
};

const decodeEmbeddedZoomValue = (value: string): string =>
  value
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");

const getCookieHeader = (headers: Headers): string => {
  const rawCookies = typeof (headers as any).getSetCookie === 'function'
    ? (headers as any).getSetCookie() as string[]
    : [headers.get('set-cookie') || ''];

  return rawCookies
    .flatMap((cookie) => cookie.split(/,(?=[^;,]+=)/g))
    .map((cookie) => cookie.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
};

const mergeCookieHeaders = (...cookies: string[]): string =>
  Array.from(new Set(
    cookies
      .flatMap((cookie) => cookie.split('; '))
      .map((cookie) => cookie.trim())
      .filter(Boolean)
  )).join('; ');

const extractZoomPageValue = (html: string, key: string): string => {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`${escapedKey}:\\s*['"]([^'"]+)['"]`, 'i'),
    new RegExp(`"${escapedKey}"\\s*:\\s*"([^"]+)"`, 'i'),
  ];

  return patterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean) || '';
};

const fetchZoomPublicJson = async <T>(
  url: string,
  cookieHeader: string,
  referer: string
): Promise<{ data: T; cookies: string }> => {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      Cookie: cookieHeader,
      Referer: referer,
      'User-Agent': 'Mozilla/5.0 BritInstituteLMS/1.0',
    },
  });

  if (!response.ok) return { data: null as T, cookies: getCookieHeader(response.headers) };

  const data = await response.json() as T;
  return { data, cookies: getCookieHeader(response.headers) };
};

const getZoomRecordingFromPublicFileId = async (
  sourceUrl: string,
  playUrl: string,
  fileId: string,
  cookieHeader: string
): Promise<ZoomRecordingsResponse | null> => {
  const source = new URL(sourceUrl);
  const originDomain = encodeURIComponent(source.host);
  const playInfoUrl = `${source.origin}/nws/recording/1.0/play/info/${encodeURIComponent(fileId)}?originDomain=${originDomain}`;
  const playInfo = await fetchZoomPublicJson<{
    errorCode?: number;
    result?: {
      mp4Url?: string;
      viewMp4Url?: string;
      duration?: number;
      transcriptList?: ZoomRecordingsResponse['publicTranscriptList'];
      highlightRanges?: string;
      recording?: { id?: string; playId?: string; displayFileName?: string };
      meet?: { topic?: string; encryptMeetingId?: string };
    };
  }>(playInfoUrl, cookieHeader, playUrl);

  if (playInfo.data?.errorCode !== 0 || !playInfo.data.result) return null;

  const result = playInfo.data.result;
  const mp4Url = result.mp4Url || result.viewMp4Url || '';
  if (!mp4Url) return null;

  return {
    id: result.meet?.encryptMeetingId || fileId,
    uuid: result.recording?.id || result.recording?.playId || fileId,
    topic: result.meet?.topic,
    share_url: sourceUrl,
    publicTranscriptList: result.transcriptList || [],
    publicHighlightRanges: result.highlightRanges || '',
    publicDuration: result.duration,
    recording_files: [{
      id: result.recording?.playId || result.recording?.id || fileId,
      file_type: 'MP4',
      file_extension: 'MP4',
      status: 'completed',
      recording_type: result.recording?.displayFileName || 'shared_screen_with_speaker_view',
      download_url: mp4Url,
      play_url: playUrl,
      public_cookie_header: cookieHeader,
      public_referer: playUrl,
    }],
  };
};

const findZoomRecordingFromPublicShare = async (
  sourceUrl: string,
  html: string,
  initialCookieHeader: string
): Promise<ZoomRecordingsResponse | null> => {
  const source = new URL(sourceUrl);
  const originDomain = encodeURIComponent(source.host);
  const meetingId = extractZoomPageValue(html, 'meetingId');
  if (!meetingId) return null;

  let cookieHeader = initialCookieHeader;
  const query = source.search ? `${source.search}&originDomain=${originDomain}` : `?originDomain=${originDomain}`;
  const shareInfoUrl = `${source.origin}/nws/recording/1.0/play/share-info/${encodeURIComponent(meetingId)}${query}`;
  const shareInfo = await fetchZoomPublicJson<{
    errorCode?: number;
    result?: { redirectUrl?: string; needRedirect?: boolean };
  }>(shareInfoUrl, cookieHeader, sourceUrl);
  cookieHeader = mergeCookieHeaders(cookieHeader, shareInfo.cookies);

  const redirectUrl = shareInfo.data?.errorCode === 0 ? shareInfo.data.result?.redirectUrl : '';
  if (!redirectUrl) return null;

  const playUrl = new URL(redirectUrl, source.origin).toString();
  const playPageResponse = await fetch(playUrl, {
    redirect: 'follow',
    headers: {
      Cookie: cookieHeader,
      Referer: sourceUrl,
      'User-Agent': 'Mozilla/5.0 BritInstituteLMS/1.0',
    },
  });
  if (!playPageResponse.ok) return null;

  cookieHeader = mergeCookieHeaders(cookieHeader, getCookieHeader(playPageResponse.headers));
  const playHtml = await playPageResponse.text();
  const fileId = extractZoomPageValue(playHtml, 'fileId');
  if (!fileId) return null;

  return getZoomRecordingFromPublicFileId(sourceUrl, playUrl, fileId, cookieHeader);
};

const findZoomRecordingFromPage = async (
  sourceUrl: string
): Promise<ZoomRecordingsResponse | null> => {
  if (!/zoom\.us\/rec\//i.test(sourceUrl)) return null;

  let html = "";
  try {
    const response = await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 BritInstituteLMS/1.0" },
    });
    if (!response.ok) return null;
    const cookieHeader = getCookieHeader(response.headers);
    html = await response.text();

    const publicShareRecording = await findZoomRecordingFromPublicShare(sourceUrl, html, cookieHeader);
    if (publicShareRecording) return publicShareRecording;

    const publicFileId = extractZoomPageValue(html, 'fileId');
    if (publicFileId) {
      const publicPlayRecording = await getZoomRecordingFromPublicFileId(sourceUrl, sourceUrl, publicFileId, cookieHeader);
      if (publicPlayRecording) return publicPlayRecording;
    }
  } catch {
    return null;
  }

  const meetingId = [
    /"meeting(?:Id|_id)"\s*:\s*"?(\d{9,14})"?/i,
    /meetingId:\s*['"]([^'"]{12,})['"]/i,
    /"meetingId"\s*:\s*"([^"]{12,})"/i,
    /meeting(?:Id|_id)=["']?(\d{9,14})/i,
    /data-meeting-id=["'](\d{9,14})["']/i,
  ].map((pattern) => html.match(pattern)?.[1]).find(Boolean);

  if (meetingId) {
    try {
      return await getZoomMeetingRecordings(meetingId);
    } catch (err) {
      if (!(err instanceof ZoomApiError) || err.status !== 404) throw err;
    }
  }

  const downloadUrl = [
    /"download_url"\s*:\s*"([^"]+)"/i,
    /"downloadUrl"\s*:\s*"([^"]+)"/i,
    /(https?:\\?\/\\?\/[^"'<>]+\/rec\/download\/[^"'<>]+)/i,
  ].map((pattern) => html.match(pattern)?.[1]).find(Boolean);

  if (!downloadUrl) return null;

  return {
    share_url: sourceUrl,
    recording_files: [{
      file_type: "MP4",
      file_extension: "MP4",
      status: "completed",
      download_url: decodeEmbeddedZoomValue(downloadUrl),
    }],
  };
};

const getZoomMeetingAgenda = (startTime: Date, duration: number): string =>
  `UK/London time: ${formatUkMeetingRange(startTime, duration)}`;

export const createZoomMeeting = async ({ topic, startTime, duration }: ZoomMeetingInput): Promise<ZoomMeetingResponse> => {
  const response = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: {
      ...(await getAuthorizedZoomHeaders()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic,
      type: 2,
      start_time: getUkZoomDateTimeValue(startTime),
      duration,
      timezone: UK_TIME_ZONE,
      agenda: getZoomMeetingAgenda(startTime, duration),
      settings: {
        join_before_host: false,
        waiting_room: true,
        approval_type: 2,
        registration_type: 1,
        audio: 'both',
        auto_recording: 'cloud',
      },
    }),
  });

  if (!response.ok) {
    const message = await getZoomErrorMessage(response, 'Unable to create Zoom meeting. Please check Zoom app scopes and account access.');
    throw new ZoomApiError(message, response.status);
  }

  return (await response.json()) as ZoomMeetingResponse;
};

export const updateZoomMeeting = async (
  meetingId: string,
  { topic, startTime, duration }: ZoomMeetingInput
): Promise<void> => {
  const response = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
    method: 'PATCH',
    headers: {
      ...(await getAuthorizedZoomHeaders()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic,
      start_time: getUkZoomDateTimeValue(startTime),
      duration,
      timezone: UK_TIME_ZONE,
      agenda: getZoomMeetingAgenda(startTime, duration),
      settings: {
        auto_recording: 'cloud',
      },
    }),
  });

  if (!response.ok) {
    const message = await getZoomErrorMessage(response, 'Unable to update Zoom meeting.');
    throw new ZoomApiError(message, response.status);
  }
};

export const deleteZoomMeeting = async (meetingId: string): Promise<void> => {
  const response = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
    method: 'DELETE',
    headers: {
      ...(await getAuthorizedZoomHeaders()),
    },
  });

  if (!response.ok && response.status !== 404) {
    const message = await getZoomErrorMessage(response, 'Unable to delete Zoom meeting.');
    throw new ZoomApiError(message, response.status);
  }
};

export const getZoomMeetingRecordings = async (meetingId: string): Promise<ZoomRecordingsResponse> => {
  const response = await fetch(`https://api.zoom.us/v2/meetings/${encodeZoomMeetingIdentifier(meetingId)}/recordings`, {
    method: 'GET',
    headers: await getAuthorizedZoomHeaders(),
  });

  if (!response.ok) {
    const message = await getZoomErrorMessage(response, 'Unable to fetch Zoom meeting recordings.');
    throw new ZoomApiError(message, response.status);
  }

  return (await response.json()) as ZoomRecordingsResponse;
};

export const findZoomRecordingByUrl = async (
  sourceUrl: string
): Promise<ZoomRecordingsResponse | null> => {
  if (!sourceUrl?.trim()) {
    return null;
  }

  const cleanedUrl = sourceUrl.trim();

  // Extract meeting id from common Zoom URL formats
  const meetingId =
    cleanedUrl.match(/\/j\/(\d+)/)?.[1] ||
    cleanedUrl.match(/\/wc\/j\/(\d+)/)?.[1] ||
    cleanedUrl.match(/[?&]mn=(\d+)/)?.[1] ||
    cleanedUrl.match(/[?&]meeting_id=(\d+)/)?.[1];

  // Try direct meeting lookup first
  if (meetingId) {
    try {
      console.log(`[Zoom] Looking up meeting ${meetingId}`);

      const recording = await getZoomMeetingRecordings(meetingId);

      if (recording) {
        console.log(`[Zoom] Found recording for meeting ${meetingId}`);

        const bestFile = pickBestZoomRecordingFile(recording);

        if (bestFile) {
          console.log(
            `[Zoom] MP4 found: ${bestFile.recording_type} (${bestFile.file_size ?? 0} bytes)`
          );
        } else {
          console.warn(
            `[Zoom] Meeting found but no completed MP4 recording yet.`
          );
        }

        return recording;
      }
    } catch (err) {
      if (!(err instanceof ZoomApiError) || err.status !== 404) {
        throw err;
      }

      console.warn(
        `[Zoom] Meeting ${meetingId} not found via direct lookup. Falling back to recording search.`
      );
    }
  }

  const pageRecording = await findZoomRecordingFromPage(cleanedUrl);
  if (pageRecording) {
    console.log("[Zoom] Recording metadata extracted from Zoom recording page.");
    return pageRecording;
  }

  const userIds = await getZoomRecordingUserIds();
  const today = new Date();

  for (const userId of userIds) {
    console.log(`[Zoom] Searching recordings for user ${userId}`);

    for (let offset = 0; offset < 365; offset += 30) {
      const to = new Date(today);
      to.setDate(today.getDate() - offset);

      const from = new Date(to);
      from.setDate(from.getDate() - 29);

      let nextPageToken = "";

      do {
        try {
          const page = await listZoomRecordingsForRange(
            userId,
            from,
            to,
            nextPageToken
          );

          const meetings = page.meetings || [];

          console.log(
            `[Zoom] ${meetings.length} recordings between ${from
              .toISOString()
              .slice(0, 10)} and ${to.toISOString().slice(0, 10)}`
          );

          for (const recording of meetings) {
            if (!zoomRecordingMatchesUrl(recording, cleanedUrl)) {
              continue;
            }

            console.log(
              `[Zoom] Matching recording found`,
              {
                id: recording.id,
                uuid: recording.uuid,
                topic: recording.topic,
                shareUrl: recording.share_url,
              }
            );

            const bestFile = pickBestZoomRecordingFile(recording);

            if (bestFile) {
              console.log(
                `[Zoom] Selected MP4`,
                {
                  recordingType: bestFile.recording_type,
                  downloadUrl: bestFile.download_url,
                  fileSize: bestFile.file_size,
                }
              );
            } else {
              console.warn(
                `[Zoom] Recording matched but contains no completed MP4 file.`
              );

              console.log(
                `[Zoom] Recording files:`,
                recording.recording_files
              );
            }

            return recording;
          }

          nextPageToken = page.next_page_token || "";
        } catch (err) {
          if (
            err instanceof ZoomApiError &&
            [401, 403, 404].includes(err.status)
          ) {
            break;
          }

          throw err;
        }
      } while (nextPageToken);
    }
  }

  console.warn(
    `[Zoom] No recording matched the supplied URL:\n${cleanedUrl}`
  );

  return null;
};

export const fetchZoomTextFile = async (downloadUrl: string): Promise<string> => {
  const response = await fetch(downloadUrl, { headers: await getAuthorizedZoomHeaders() });
  if (!response.ok) {
    const message = await getZoomErrorMessage(response, 'Unable to fetch Zoom text file.');
    throw new ZoomApiError(message, response.status);
  }
  return response.text();
};

export const fetchZoomRecordingFile = async (downloadUrl: string, range?: string): Promise<Response> => {
  const headers = await getAuthorizedZoomHeaders(range ? { Range: range } : undefined);
  const response = await fetch(downloadUrl, { headers });

  if (!response.ok && response.status !== 206) {
    const message = await getZoomErrorMessage(response, 'Unable to stream Zoom recording.');
    throw new ZoomApiError(message, response.status);
  }

  return response;
};

export const fetchZoomPublicRecordingFile = async (
  file: ZoomRecordingFile,
  range?: string
): Promise<Response> => {
  if (!file.download_url) {
    throw new ZoomApiError('Zoom recording file is missing a download URL.', 404);
  }

  const response = await fetch(file.download_url, {
    redirect: 'follow',
    headers: {
      ...(range ? { Range: range } : {}),
      ...(file.public_cookie_header ? { Cookie: file.public_cookie_header } : {}),
      ...(file.public_referer ? { Referer: file.public_referer } : {}),
      'User-Agent': 'Mozilla/5.0 BritInstituteLMS/1.0',
    },
  });

  if (!response.ok && response.status !== 206) {
    const message = await getZoomErrorMessage(response, 'Unable to stream Zoom recording.');
    throw new ZoomApiError(message, response.status);
  }

  return response;
};



interface ParsedTranscript {
  summary: string;
  chapters: {
    start: number;
    title: string;
    text: string;
  }[];
  transcript: {
    start: number;
    speaker?: string;
    text: string;
  }[];
}

const timeToSeconds = (time: string): number => {
  const parts = time.split(":").map(Number);

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + Math.floor(parts[2]);
  }

  if (parts.length === 2) {
    return parts[0] * 60 + Math.floor(parts[1]);
  }

  return 0;
};

export const parseZoomTranscript = (
  transcript: string
): ParsedTranscript => {
  const lines = transcript.split(/\r?\n/);

  const transcriptItems: ParsedTranscript["transcript"] = [];
  const chapters: ParsedTranscript["chapters"] = [];

  let currentTime = 0;
  let currentText: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) continue;

    // Skip WEBVTT header
    if (line === "WEBVTT") continue;

    // Timestamp
    const match = line.match(
      /(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*-->\s*(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/
    );

    if (match) {
      if (currentText.length) {
        transcriptItems.push({
          start: currentTime,
          text: currentText.join(" "),
        });

        currentText = [];
      }

      currentTime = timeToSeconds(match[1]);
      continue;
    }

    currentText.push(line);
  }

  if (currentText.length) {
    transcriptItems.push({
      start: currentTime,
      text: currentText.join(" "),
    });
  }

  // Create chapters every ~5 transcript blocks
  for (let i = 0; i < transcriptItems.length; i += 5) {
    const block = transcriptItems.slice(i, i + 5);

    chapters.push({
      start: block[0]?.start || 0,
      title: `Chapter ${chapters.length + 1}`,
      text: block.map(x => x.text).join(" "),
    });
  }

  // Create simple summary
  const summary = transcriptItems
    .slice(0, 8)
    .map(x => x.text)
    .join(" ")
    .slice(0, 600);

  return {
    summary,
    chapters,
    transcript: transcriptItems,
  };
};
