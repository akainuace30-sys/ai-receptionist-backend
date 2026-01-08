import express from 'express';
import { handleDialog } from '../services/dialogService.js';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const result = await handleDialog({
      tenantId: req.tenant.id,
      sessionId: req.body?.session_id,
      text: req.body?.text
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
