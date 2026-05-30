import { Router } from 'express';
import { getMe, getSessionConfig, heartbeat, login, logoutSession } from '../controllers/auth.controller';
import { protect } from '../middleware/auth.middleware';

const router = Router();

router.get('/session-config', getSessionConfig);
router.post('/login', login);
router.get('/me', protect, getMe);
router.post('/heartbeat', protect, heartbeat);
router.post('/logout', protect, logoutSession);

export default router;
