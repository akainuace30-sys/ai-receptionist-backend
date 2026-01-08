import { v4 as uuidv4 } from 'uuid';
import { runWithContext } from '../services/logger.js';

export function requestContext(req, res, next) {
  const requestId = req.headers['x-request-id'] || uuidv4();
  const context = {
    request_id: requestId,
    tenant_id: null,
    session_id: req.body?.session_id || req.params?.id || null
  };
  req.context = context;
  runWithContext(context, () => {
    res.setHeader('x-request-id', requestId);
    next();
  });
}
