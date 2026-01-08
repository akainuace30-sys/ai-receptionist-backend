import express from 'express';
import { processDialog } from '../services/dialogService.js';
import { logger } from '../services/logger.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireRole } from '../middleware/auth.js';

const router = express.Router();

router.use(rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'dialog' }));
router.use(requireRole(['system', 'tenant_admin', 'operator']));

router.post('/', async (req, res, next) => {
  try {
    const context = { ipAddress: req.ip, userAgent: req.get('user-agent'), channel: 'api' };
    const result = await processDialog({ ...(req.body || {}), context, tenant_id: req.tenant?.id });
    res.json(result);
  } catch (err) {
    logger.error('dialog_error', { session_id: req.body?.session_id, error: err.name });
    next(err);
  }
});

export default router;
