import crypto from 'crypto';
import { getPool } from '../services/db.js';

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function requireAuth(req, _res, next) {
  const tenantId = req.headers['x-tenant-id'];
  const apiKey = req.headers['x-api-key'];
  if (!tenantId || !apiKey) {
    const err = new Error('Missing auth headers');
    err.status = 401;
    err.code = 'AUTH_MISSING';
    return next(err);
  }
  const pool = getPool();
  const { rows } = await pool.query('SELECT id, api_key_hash FROM tenants WHERE id=$1', [tenantId]);
  const tenant = rows[0];
  if (!tenant) {
    const err = new Error('Tenant not found');
    err.status = 403;
    err.code = 'TENANT_NOT_FOUND';
    return next(err);
  }
  if (tenant.api_key_hash !== hashKey(apiKey)) {
    const err = new Error('Invalid API key');
    err.status = 401;
    err.code = 'AUTH_INVALID';
    return next(err);
  }
  req.tenant = { id: tenant.id };
  return next();
}
