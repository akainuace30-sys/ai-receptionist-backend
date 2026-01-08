import express from 'express';
import dialogRouter from './routes/dialog.js';
import sessionRouter from './routes/session.js';
import submitRouter from './routes/submit.js';
import voiceRouter from './routes/voice.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/dialog', dialogRouter);
app.use('/session', sessionRouter);
app.use('/submit', submitRouter);
app.use('/voice', voiceRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

export default app;
