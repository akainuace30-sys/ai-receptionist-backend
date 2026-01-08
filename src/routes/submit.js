import express from 'express';
import { submitIntake } from '../services/dialogService.js';
import { logger } from '../services/logger.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireRole } from '../middleware/auth.js';

const router = express.Router();

router.use(rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'submit' }));
router.use(requireRole(['system', 'tenant_admin', 'operator']));

router.post('/:id', async (req, res, next) => {
  try {
    const snapshot = await submitIntake(req.params.id, req.tenant?.id);
    if (!snapshot) return res.status(404).json({ error: 'Not found' });
    res.json(snapshot);
  } catch (err) {
    logger.error('submit_error', { session_id: req.params.id, error: err.name });
    next(err);
  }
});

export default router;
