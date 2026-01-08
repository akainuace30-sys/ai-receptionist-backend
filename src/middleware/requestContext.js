import { v4 as uuidv4 } from 'uuid';

export function requestContext(req, res, next) {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.context = { request_id: requestId };
  res.setHeader('x-request-id', requestId);
  next();
}
