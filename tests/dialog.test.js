import request from 'supertest';
import app from '../src/app.js';
import { getPool, runMigrations } from '../src/db/index.js';

describe('Dialog API', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    const pool = getPool();
    await pool.query('TRUNCATE messages, intakes, sessions RESTART IDENTITY CASCADE');
  });

  test('returns 400 when text missing', async () => {
    const res = await request(app).post('/dialog').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing text');
  });

  test('persists state across session_id', async () => {
    const consent = await request(app).post('/dialog').send({ text: 'ja' });
    const sessionId = consent.body.session_id;
    const name = await request(app).post('/dialog').send({ session_id: sessionId, text: 'Max Mustermann' });
    expect(name.body.session_id).toBe(sessionId);
    expect(name.body.state).toBe('NAME_CONFIRM');
  });

  test('rejects invalid phone', async () => {
    const consent = await request(app).post('/dialog').send({ text: 'ja' });
    const sessionId = consent.body.session_id;
    await request(app).post('/dialog').send({ session_id: sessionId, text: 'Max' });
    await request(app).post('/dialog').send({ session_id: sessionId, text: 'ja' });
    const phone = await request(app).post('/dialog').send({ session_id: sessionId, text: 'abc' });
    expect(phone.body.state).toBe('PHONE');
    expect(phone.body.reply_text).toMatch(/nicht gültig/);
  });

  test('happy path traffic', async () => {
    let res = await request(app).post('/dialog').send({ text: 'ja' });
    const sessionId = res.body.session_id;
    res = await request(app).post('/dialog').send({ session_id: sessionId, text: 'Max Mustermann' });
    res = await request(app).post('/dialog').send({ session_id: sessionId, text: 'ja' });
    res = await request(app).post('/dialog').send({ session_id: sessionId, text: '+49171123456' });
    res = await request(app).post('/dialog').send({ session_id: sessionId, text: 'ja' });
    res = await request(app).post('/dialog').send({ session_id: sessionId, text: 'Ich hatte gestern einen Autounfall in Berlin.' });
    expect(res.body.case_type).toBe('traffic');
    res = await request(app).post('/dialog').send({ session_id: sessionId, text: '12.01.2024' });
    res = await request(app).post('/dialog').send({ session_id: sessionId, text: 'Berlin' });
    res = await request(app).post('/dialog').send({ session_id: sessionId, text: 'nein' });
    res = await request(app).post('/dialog').send({ session_id: sessionId, text: 'ja' });
    res = await request(app).post('/dialog').send({ session_id: sessionId, text: 'ja' });
    expect(res.body.state).toBe('SUMMARY_CONFIRM');
    res = await request(app).post('/dialog').send({ session_id: sessionId, text: 'ja' });
    expect(res.body.done).toBe(true);
    expect(res.body.state).toBe('DONE');
  });
});
