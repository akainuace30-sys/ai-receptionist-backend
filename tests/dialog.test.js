import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import app from '../src/app.js';
import { getPool, runMigrations } from '../src/db/index.js';
import { hashApiKey } from '../src/utils/crypto.js';

const tenantId = uuidv4();
const apiKey = 'test-api-key';

function withAuth(req) {
  return req.set('x-tenant-id', tenantId).set('x-api-key', apiKey).set('x-role', 'tenant_admin');
}

describe('Dialog API', () => {
  beforeAll(async () => {
    await runMigrations();
    const pool = getPool();
    await pool.query('INSERT INTO tenants (id, name, api_key_hash) VALUES ($1,$2,$3)', [
      tenantId,
      'Test Kanzlei',
      hashApiKey(apiKey)
    ]);
  });

  beforeEach(async () => {
    const pool = getPool();
    await pool.query(
      'TRUNCATE messages, intakes, sessions, consents, session_transitions, lead_scores RESTART IDENTITY CASCADE'
    );
  });

  test('returns 400 when text missing', async () => {
    const res = await withAuth(request(app).post('/dialog')).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing text');
  });

  test('persists state across session_id', async () => {
    const consent = await withAuth(request(app).post('/dialog')).send({ text: 'ja' });
    const sessionId = consent.body.session_id;
    const name = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'Max Mustermann' });
    expect(name.body.session_id).toBe(sessionId);
    expect(name.body.state).toBe('NAME_CONFIRM');
  });

  test('rejects invalid phone', async () => {
    const consent = await withAuth(request(app).post('/dialog')).send({ text: 'ja' });
    const sessionId = consent.body.session_id;
    await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'Max' });
    await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'ja' });
    const phone = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'abc' });
    expect(phone.body.state).toBe('PHONE');
    expect(phone.body.reply_text).toMatch(/nicht gültig/);
  });

  test('consent rejection ends session', async () => {
    const res = await withAuth(request(app).post('/dialog')).send({ text: 'nein' });
    expect(res.body.done).toBe(true);
    expect(res.body.state).toBe('DONE');
  });

  test('happy path traffic', async () => {
    let res = await withAuth(request(app).post('/dialog')).send({ text: 'ja' });
    const sessionId = res.body.session_id;
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'Max Mustermann' });
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'ja' });
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: '+49171123456' });
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'ja' });
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'max@example.de' });
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'ja' });
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'Berlin' });
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'Ich hatte gestern einen Autounfall in Berlin.' });
    expect(res.body.case_type).toBe('traffic');
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'hoch' });
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: '12.01.2024' });
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'Berlin' });
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'nein' });
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'ja' });
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'ja' });
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: '15000' });
    expect(res.body.state).toBe('SUMMARY_CONFIRM');
    res = await withAuth(request(app).post('/dialog')).send({ session_id: sessionId, text: 'ja' });
    expect(res.body.done).toBe(true);
    expect(res.body.state).toBe('DONE');
  });

  test('voice flow uses same dialog engine', async () => {
    const inbound = await withAuth(request(app).post('/voice/inbound')).send({});
    expect(inbound.status).toBe(200);
    expect(inbound.text).toMatch(/<Gather/);

    const gather = await withAuth(request(app).post('/voice/gather')).send({ SpeechResult: 'ja', CallSid: 'CA123' });
    expect(gather.status).toBe(200);
    expect(gather.text).toMatch(/<Response/);
  });
});
