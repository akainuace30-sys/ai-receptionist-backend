import express from 'express';
import { submitIntake } from '../services/dialogService.js';

const router = express.Router();

router.post('/:id', async (req, res) => {
  try {
    const snapshot = await submitIntake(req.params.id);
    if (!snapshot) return res.status(404).json({ error: 'Not found' });
    res.json(snapshot);
  } catch (err) {
    console.error('Submit error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
