import { getContext } from '../services/logger.js';

const buckets = new Map();

function getBucket(key, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) {
    const fresh = { start: now, count: 0 };
    buckets.set(key, fresh);
    return fresh;
  }
  return bucket;
}

export function rateLimit({ windowMs, max, keyPrefix }) {
  return (req, res, next) => {
    const tenantId = req.tenant?.id || 'unknown';
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const key = `${keyPrefix}:${tenantId}:${ip}`;
    const bucket = getBucket(key, windowMs);
    bucket.count += 1;
    if (bucket.count > max) {
      const context = getContext();
      res.status(429).json({
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT',
        request_id: context.request_id
      });
      return;
    }
    res.setHeader('x-rate-limit-limit', max);
    res.setHeader('x-rate-limit-remaining', Math.max(0, max - bucket.count));
    res.setHeader('x-rate-limit-reset', bucket.start + windowMs);
    next();
  };
}
