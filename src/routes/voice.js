import express from 'express';
import { create } from 'xmlbuilder2';
import { handleDialog } from '../services/dialogService.js';

const router = express.Router();

function buildGatherResponse(message, actionUrl) {
  return create({ version: '1.0', encoding: 'UTF-8' })
    .ele('Response')
    .ele('Gather', { input: 'speech dtmf', action: actionUrl, method: 'POST' })
    .ele('Say')
    .txt(message)
    .up()
    .up()
    .up()
    .end({ prettyPrint: true });
}

router.post('/inbound', (_req, res) => {
  const twiml = buildGatherResponse('Willkommen. Bitte sagen Sie kurz Ihr Anliegen.', '/voice/gather');
  res.type('text/xml').send(twiml);
});

router.post('/gather', async (req, res, next) => {
  try {
    const speech = req.body.SpeechResult || req.body.Digits || '';
    const sessionId = req.body.CallSid;
    const result = await handleDialog({ tenantId: req.tenant.id, sessionId, text: speech });
    const message = result.done ? 'Vielen Dank. Wir melden uns.' : result.reply_text;
    const twiml = buildGatherResponse(message, '/voice/gather');
    res.type('text/xml').send(twiml);
  } catch (err) {
    next(err);
  }
});

export default router;
