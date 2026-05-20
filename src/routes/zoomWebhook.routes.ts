import { Router } from 'express';
import { handleZoomWebhook } from '../controllers/zoomWebhook.controller';

const router = Router();

router.post('/', handleZoomWebhook);

export default router;
