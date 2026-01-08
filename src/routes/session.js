import express from 'express';
import { getSessionSnapshot } from '../services/dialogService.js';

const router = express.Router();

router.get('/:id', async (req, res) => {
  const session = await getSessionSnapshot(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});

export default router;
