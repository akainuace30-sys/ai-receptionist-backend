import express from 'express';
import { processDialog } from '../services/dialogService.js';
import { logger } from '../services/logger.js';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const context = { ipAddress: req.ip, userAgent: req.get('user-agent'), channel: 'api' };
    const result = await processDialog({ ...(req.body || {}), context });
    res.json(result);
  } catch (err) {
    logger.error('dialog_error', { session_id: req.body?.session_id, error: err.name });
    next(err);
  }
});

export default router;
