import { Router } from 'express';
import { changePassword, getMe, getSessionConfig, heartbeat, login, logoutSession } from '../controllers/auth.controller';
import { protect } from '../middleware/auth.middleware';

const router = Router();

router.get('/session-config', getSessionConfig);
router.post('/login', login);
router.get('/me', protect, getMe);
router.put('/password', protect, changePassword);
router.post('/heartbeat', protect, heartbeat);
router.post('/logout', protect, logoutSession);

export default router;
