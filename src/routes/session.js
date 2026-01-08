import express from 'express';
import { getSessionSnapshot } from '../services/dialogService.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireRole } from '../middleware/auth.js';

const router = express.Router();

router.use(rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'session' }));
router.use(requireRole(['system', 'tenant_admin', 'operator']));

router.get('/:id', async (req, res, next) => {
  try {
    const session = await getSessionSnapshot(req.params.id, req.tenant?.id);
    if (!session) return res.status(404).json({ error: 'Not found' });
    res.json(session);
  } catch (err) {
    next(err);
  }
});

export default router;
