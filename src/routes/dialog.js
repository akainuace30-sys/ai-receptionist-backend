import express from 'express';
import { processDialog } from '../services/dialogService.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const result = await processDialog(req.body || {});
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json(err.body);
    }
    console.error('Dialog error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
