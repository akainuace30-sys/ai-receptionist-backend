import express from 'express';
import dialogRouter from './routes/dialog.js';
import sessionRouter from './routes/session.js';
import submitRouter from './routes/submit.js';
import voiceRouter from './routes/voice.js';
import { logger } from './services/logger.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/dialog', dialogRouter);
app.use('/session', sessionRouter);
app.use('/submit', submitRouter);
app.use('/voice', voiceRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) {
    logger.error('request_failed', { error: err.name, status });
  } else {
    logger.warn('request_rejected', { error: err.name, status });
  }
  const body = { error: err.message || 'Internal error' };
  if (err.details) body.details = err.details;
  res.status(status).json(body);
});

export default app;
