import express from 'express';
import { processDialog } from '../services/dialogService.js';
import { create } from 'xmlbuilder2';
import { logger } from '../services/logger.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireRole } from '../middleware/auth.js';
import { metrics } from '../services/metrics.js';

const router = express.Router();

router.use(rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'voice' }));
router.use(requireRole(['system', 'tenant_admin', 'operator']));

function buildGatherResponse(message, actionUrl) {
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('Response')
    .ele('Gather', { input: 'speech dtmf', action: actionUrl, method: 'POST' })
    .ele('Say')
    .txt(message)
    .up()
    .up()
    .up();
  return doc.end({ prettyPrint: true });
}

router.post('/inbound', (req, res) => {
  const actionUrl = '/voice/gather';
  const message = 'Willkommen bei Ihrer Kanzlei. Bitte sagen Sie kurz Ihr Anliegen.';
  const twiml = buildGatherResponse(message, actionUrl);
  res.type('text/xml').send(twiml);
});

router.post('/gather', async (req, res) => {
  const speech = req.body.SpeechResult || req.body.Digits || '';
  const sessionId = req.body.session_id || req.body.CallSid;
  try {
    if (!speech) {
      metrics.increment('voice.timeout');
    }
    const context = { ipAddress: req.ip, userAgent: req.get('user-agent'), channel: 'voice' };
    const result = await processDialog({
      session_id: sessionId,
      text: speech,
      context,
      tenant_id: req.tenant?.id
    });
    const doneMessage = result.done ? 'Vielen Dank. Wir melden uns zeitnah.' : result.reply_text;
    const twiml = buildGatherResponse(doneMessage, '/voice/gather');
    res.type('text/xml').send(twiml);
  } catch (err) {
    logger.error('voice_error', { session_id: sessionId, error: err.name });
    const twiml = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('Response')
      .ele('Say')
      .txt('Entschuldigung, es gab ein Problem.')
      .up()
      .up()
      .end({ prettyPrint: true });
    res.type('text/xml').send(twiml);
  }
});

export default router;
