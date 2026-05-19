import { config } from '../config/env';

interface ZoomTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface ZoomMeetingResponse {
  id: number;
  join_url: string;
  start_url: string;
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

export const createZoomMeeting = async ({ topic, startTime, duration }: ZoomMeetingInput): Promise<ZoomMeetingResponse> => {
  const token = await getAccessToken();
  const response = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic,
      type: 2,
      start_time: startTime.toISOString(),
      duration,
      timezone: 'Asia/Kolkata',
      settings: {
        join_before_host: false,
        waiting_room: true,
        approval_type: 2,
        registration_type: 1,
        audio: 'both',
        auto_recording: 'none',
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
  const token = await getAccessToken();
  const response = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic,
      start_time: startTime.toISOString(),
      duration,
      timezone: 'Asia/Kolkata',
    }),
  });

  if (!response.ok) {
    const message = await getZoomErrorMessage(response, 'Unable to update Zoom meeting.');
    throw new ZoomApiError(message, response.status);
  }
};

export const deleteZoomMeeting = async (meetingId: string): Promise<void> => {
  const token = await getAccessToken();
  const response = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok && response.status !== 404) {
    const message = await getZoomErrorMessage(response, 'Unable to delete Zoom meeting.');
    throw new ZoomApiError(message, response.status);
  }
};
