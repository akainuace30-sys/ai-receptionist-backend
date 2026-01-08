import express from 'express';
import { requestContext } from './middleware/requestContext.js';
import { requireAuth } from './middleware/auth.js';
import dialogRouter from './routes/dialog.js';
import sessionRouter from './routes/session.js';
import voiceRouter from './routes/voice.js';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestContext);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use(requireAuth);
app.use('/dialog', dialogRouter);
app.use('/session', sessionRouter);
app.use('/voice', voiceRouter);

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal error',
    code: err.code || 'UNKNOWN_ERROR'
  });
});

export default app;
