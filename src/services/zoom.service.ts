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

export const fetchZoomRecordingFile = async (downloadUrl: string, range?: string): Promise<Response> => {
  const headers = await getAuthorizedZoomHeaders(range ? { Range: range } : undefined);
  const response = await fetch(downloadUrl, { headers });

  if (!response.ok && response.status !== 206) {
    const message = await getZoomErrorMessage(response, 'Unable to stream Zoom recording.');
    throw new ZoomApiError(message, response.status);
  }

  return response;
};
