import express from 'express';
import { getPool } from '../services/db.js';

const router = express.Router();

router.get('/:id', async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM sessions WHERE id=$1 AND tenant_id=$2', [
      req.params.id,
      req.tenant.id
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
