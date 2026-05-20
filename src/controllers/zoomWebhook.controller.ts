import crypto from 'crypto';
import { Request, Response } from 'express';
import { config } from '../config/env';
import { LiveClass } from '../models/LiveClass.model';
import { syncZoomRecordingForLiveClass } from '../services/recordedLectureSync.service';
import { ZoomRecordingsResponse } from '../services/zoom.service';

interface ZoomWebhookBody {
  event?: string;
  payload?: {
    plainToken?: string;
    object?: ZoomRecordingsResponse;
  };
}

const getRawBody = (req: Request): Buffer => {
  if (Buffer.isBuffer(req.body)) return req.body;
  return Buffer.from(JSON.stringify(req.body || {}));
};

const getBody = (req: Request): ZoomWebhookBody => {
  const rawBody = getRawBody(req);
  return JSON.parse(rawBody.toString('utf8')) as ZoomWebhookBody;
};

const createZoomSignature = (message: string): string => (
  crypto
    .createHmac('sha256', config.zoom.webhookSecretToken)
    .update(message)
    .digest('hex')
);

const verifyZoomWebhook = (req: Request): boolean => {
  if (!config.zoom.webhookSecretToken) return true;

  const timestamp = String(req.headers['x-zm-request-timestamp'] || '');
  const signature = String(req.headers['x-zm-signature'] || '');
  if (!timestamp || !signature) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const message = `v0:${timestamp}:${getRawBody(req).toString('utf8')}`;
  const expected = `v0=${createZoomSignature(message)}`;
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
};

export const handleZoomWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = getBody(req);

    if (body.event === 'endpoint.url_validation') {
      const plainToken = body.payload?.plainToken || '';
      const encryptedToken = createZoomSignature(plainToken);
      res.json({ plainToken, encryptedToken });
      return;
    }

    if (!verifyZoomWebhook(req)) {
      res.status(401).json({ success: false, message: 'Invalid Zoom webhook signature' });
      return;
    }

    if (body.event === 'recording.completed') {
      const recording = body.payload?.object;
      const meetingId = recording?.id ? String(recording.id) : '';
      const meetingUuid = recording?.uuid ? String(recording.uuid) : '';

      const liveClass = await LiveClass.findOne({
        $or: [
          ...(meetingId ? [{ zoomMeetingId: meetingId }] : []),
          ...(meetingUuid ? [{ zoomMeetingUuid: meetingUuid }] : []),
        ],
      });

      if (liveClass && recording) {
        await syncZoomRecordingForLiveClass(liveClass, recording);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Zoom webhook error:', err);
    res.status(400).json({ success: false, message: 'Unable to process Zoom webhook' });
  }
};
