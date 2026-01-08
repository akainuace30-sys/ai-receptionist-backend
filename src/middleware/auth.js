import { getPool } from '../db/index.js';
import { hashApiKey } from '../utils/crypto.js';
import { UserError } from '../utils/errors.js';

const ROLES = ['system', 'tenant_admin', 'operator'];

function resolveRole(headerValue) {
  if (!headerValue) return 'tenant_admin';
  const normalized = headerValue.toLowerCase();
  return ROLES.includes(normalized) ? normalized : 'tenant_admin';
}

export async function requireAuth(req, _res, next) {
  const tenantId = req.headers['x-tenant-id'];
  const apiKey = req.headers['x-api-key'];

  if (!tenantId || !apiKey) {
    return next(new UserError('Missing tenant auth headers', 401, {}, 'AUTH_MISSING'));
  }

  const pool = getPool();
  const { rows } = await pool.query('SELECT id, api_key_hash, status, retention_days FROM tenants WHERE id=$1', [
    tenantId
  ]);
  const tenant = rows[0];
  if (!tenant || tenant.status !== 'active') {
    return next(new UserError('Tenant not active', 403, {}, 'TENANT_INACTIVE'));
  }
  if (tenant.api_key_hash !== hashApiKey(apiKey)) {
    return next(new UserError('Invalid API key', 401, {}, 'AUTH_INVALID'));
  }

  const role = resolveRole(req.headers['x-role']);
  req.tenant = { id: tenant.id, retention_days: tenant.retention_days };
  req.auth = { role };
  if (req.context) {
    req.context.tenant_id = tenant.id;
  }
  return next();
}

export function requireRole(allowedRoles = []) {
  return (req, _res, next) => {
    const role = req.auth?.role;
    if (!role || !allowedRoles.includes(role)) {
      return next(new UserError('Forbidden', 403, {}, 'AUTH_FORBIDDEN'));
    }
    return next();
  };
}
