import { v4 as uuidv4 } from 'uuid';
import { getPool } from './db.js';
import { classifyCaseType, buildSummary } from './llmService.js';
import {
  isAffirmative,
  isNegative,
  normalizeName,
  extractPhone,
  extractEmail,
  extractJurisdiction,
  normalizeUrgency
} from '../utils/validation.js';
import { scoreLead } from './leadScoring.js';

const STATES = {
  CONSENT: 'CONSENT',
  NAME: 'NAME',
  PHONE: 'PHONE',
  EMAIL: 'EMAIL',
  JURISDICTION: 'JURISDICTION',
  DESCRIPTION: 'DESCRIPTION',
  URGENCY: 'URGENCY',
  CASE_DETAILS: 'CASE_DETAILS',
  SUMMARY: 'SUMMARY',
  DONE: 'DONE'
};

const CASE_FIELDS = {
  traffic: ['datum', 'ort', 'verletzungen', 'polizei'],
  employment: ['datum', 'arbeitgeber', 'status', 'dokumente'],
  family: ['thema', 'kinder', 'dringlichkeit_detail']
};

export async function handleDialog({ tenantId, sessionId, text }) {
  if (!text) {
    const err = new Error('Missing text');
    err.status = 400;
    err.code = 'VALIDATION_MISSING_TEXT';
    throw err;
  }
  const pool = getPool();
  const session = await ensureSession(pool, tenantId, sessionId);
  const intake = await loadIntake(pool, tenantId, session.id);
  await appendMessage(pool, tenantId, session.id, 'user', text);

  const response = await advanceState(pool, tenantId, session, intake, text);
  const updatedIntake = await loadIntake(pool, tenantId, session.id);
  const leadScore = scoreLead(updatedIntake);
  await updateIntake(pool, tenantId, session.id, { lead_score: leadScore.score, lead_tier: leadScore.tier });
  await appendMessage(pool, tenantId, session.id, 'assistant', response.reply_text);

  return {
    session_id: session.id,
    reply_text: response.reply_text,
    state: response.state,
    case_type: updatedIntake.case_type,
    extracted_fields: {
      name: updatedIntake.name,
      phone: updatedIntake.phone,
      email: updatedIntake.email,
      jurisdiction: updatedIntake.jurisdiction,
      description: updatedIntake.description,
      urgency: updatedIntake.urgency,
      data: updatedIntake.data
    },
    done: response.done
  };
}

async function ensureSession(pool, tenantId, sessionId) {
  if (sessionId) {
    const { rows } = await pool.query('SELECT * FROM sessions WHERE id=$1 AND tenant_id=$2', [sessionId, tenantId]);
    if (rows[0]) return rows[0];
  }
  const id = sessionId || uuidv4();
  await pool.query('INSERT INTO sessions (id, tenant_id, status, state) VALUES ($1,$2,$3,$4)', [
    id,
    tenantId,
    'active',
    STATES.CONSENT
  ]);
  await pool.query('INSERT INTO intakes (session_id, tenant_id, data) VALUES ($1,$2,$3)', [
    id,
    tenantId,
    JSON.stringify({})
  ]);
  return (await pool.query('SELECT * FROM sessions WHERE id=$1', [id])).rows[0];
}

async function loadIntake(pool, tenantId, sessionId) {
  const { rows } = await pool.query('SELECT * FROM intakes WHERE session_id=$1 AND tenant_id=$2', [sessionId, tenantId]);
  const intake = rows[0];
  if (intake && typeof intake.data === 'string') {
    intake.data = JSON.parse(intake.data);
  }
  return intake;
}

async function appendMessage(pool, tenantId, sessionId, role, text) {
  await pool.query('INSERT INTO messages (id, tenant_id, session_id, role, text) VALUES ($1,$2,$3,$4,$5)', [
    uuidv4(),
    tenantId,
    sessionId,
    role,
    text
  ]);
}

async function advanceState(pool, tenantId, session, intake, text) {
  switch (session.state) {
    case STATES.CONSENT:
      return handleConsent(pool, tenantId, session, text);
    case STATES.NAME:
      return handleName(pool, tenantId, session, text);
    case STATES.PHONE:
      return handlePhone(pool, tenantId, session, text);
    case STATES.EMAIL:
      return handleEmail(pool, tenantId, session, text);
    case STATES.JURISDICTION:
      return handleJurisdiction(pool, tenantId, session, text);
    case STATES.DESCRIPTION:
      return handleDescription(pool, tenantId, session, text);
    case STATES.URGENCY:
      return handleUrgency(pool, tenantId, session, text);
    case STATES.CASE_DETAILS:
      return handleCaseDetails(pool, tenantId, session, intake, text);
    case STATES.SUMMARY:
      return handleSummary(pool, tenantId, session, intake);
    default:
      return { reply_text: 'Vielen Dank. Die Sitzung ist abgeschlossen.', state: STATES.DONE, done: true };
  }
}

async function handleConsent(pool, tenantId, session, text) {
  if (isNegative(text)) {
    await updateSession(pool, tenantId, session.id, { state: STATES.DONE, status: 'declined' });
    return { reply_text: 'Alles klar, wir beenden das Gespräch.', state: STATES.DONE, done: true };
  }
  if (isAffirmative(text)) {
    await updateSession(pool, tenantId, session.id, { state: STATES.NAME });
    return { reply_text: 'Vielen Dank. Wie ist Ihr vollständiger Name?', state: STATES.NAME, done: false };
  }
  return { reply_text: 'Bitte bestätigen Sie die Einwilligung (ja/nein).', state: STATES.CONSENT, done: false };
}

async function handleName(pool, tenantId, session, text) {
  const name = normalizeName(text);
  await updateIntake(pool, tenantId, session.id, { name });
  await updateSession(pool, tenantId, session.id, { state: STATES.PHONE });
  return { reply_text: 'Bitte nennen Sie Ihre Telefonnummer.', state: STATES.PHONE, done: false };
}

async function handlePhone(pool, tenantId, session, text) {
  const phone = extractPhone(text);
  if (!phone) {
    return { reply_text: 'Die Nummer wirkt ungültig. Bitte erneut angeben.', state: STATES.PHONE, done: false };
  }
  await updateIntake(pool, tenantId, session.id, { phone });
  await updateSession(pool, tenantId, session.id, { state: STATES.EMAIL });
  return { reply_text: 'Bitte nennen Sie Ihre E-Mail-Adresse.', state: STATES.EMAIL, done: false };
}

async function handleEmail(pool, tenantId, session, text) {
  const email = extractEmail(text);
  if (!email) {
    return { reply_text: 'Bitte geben Sie eine gültige E-Mail an.', state: STATES.EMAIL, done: false };
  }
  await updateIntake(pool, tenantId, session.id, { email });
  await updateSession(pool, tenantId, session.id, { state: STATES.JURISDICTION });
  return { reply_text: 'In welchem Bundesland ist der Fall?', state: STATES.JURISDICTION, done: false };
}

async function handleJurisdiction(pool, tenantId, session, text) {
  const jurisdiction = extractJurisdiction(text);
  await updateIntake(pool, tenantId, session.id, { jurisdiction });
  await updateSession(pool, tenantId, session.id, { state: STATES.DESCRIPTION });
  return { reply_text: 'Bitte schildern Sie kurz Ihr Anliegen.', state: STATES.DESCRIPTION, done: false };
}

async function handleDescription(pool, tenantId, session, text) {
  const classification = await classifyCaseType(text);
  await updateIntake(pool, tenantId, session.id, {
    description: text.trim(),
    case_type: classification.case_type
  });
  await updateSession(pool, tenantId, session.id, { state: STATES.URGENCY });
  return { reply_text: 'Wie dringend ist die Angelegenheit?', state: STATES.URGENCY, done: false };
}

async function handleUrgency(pool, tenantId, session, text) {
  const urgency = normalizeUrgency(text);
  await updateIntake(pool, tenantId, session.id, { urgency });
  await updateSession(pool, tenantId, session.id, { state: STATES.CASE_DETAILS });
  return { reply_text: 'Bitte nennen Sie weitere Falldetails.', state: STATES.CASE_DETAILS, done: false };
}

async function handleCaseDetails(pool, tenantId, session, intake, text) {
  const caseType = intake.case_type || 'other';
  const data = { ...(intake.data || {}) };
  const fields = CASE_FIELDS[caseType] || [];
  const nextField = fields.find((field) => !data[field]);
  if (nextField) {
    data[nextField] = text.trim();
    await updateIntake(pool, tenantId, session.id, { data });
    return { reply_text: `Bitte teilen Sie ${fields.find((f) => !data[f]) || 'weitere Details'} mit.`, state: STATES.CASE_DETAILS, done: false };
  }
  await updateIntake(pool, tenantId, session.id, { data });
  await updateSession(pool, tenantId, session.id, { state: STATES.SUMMARY });
  return handleSummary(pool, tenantId, session, { ...intake, data });
}

async function handleSummary(pool, tenantId, session, intake) {
  const summary = await buildSummary(intake);
  await updateIntake(pool, tenantId, session.id, { summary });
  await updateSession(pool, tenantId, session.id, { state: STATES.DONE, status: 'completed' });
  return { reply_text: `${summary}\nVielen Dank. Wir melden uns.`, state: STATES.DONE, done: true };
}

async function updateSession(pool, tenantId, sessionId, fields) {
  const keys = Object.keys(fields);
  const assignments = keys.map((key, idx) => `${key}=$${idx + 1}`).join(', ');
  const values = keys.map((key) => fields[key]);
  values.push(sessionId, tenantId);
  await pool.query(
    `UPDATE sessions SET ${assignments} WHERE id=$${values.length - 1} AND tenant_id=$${values.length}`,
    values
  );
}

async function updateIntake(pool, tenantId, sessionId, fields) {
  const keys = Object.keys(fields);
  const assignments = keys.map((key, idx) => `${key}=$${idx + 1}`).join(', ');
  const values = keys.map((key) => {
    const value = fields[key];
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  });
  values.push(sessionId, tenantId);
  await pool.query(
    `UPDATE intakes SET ${assignments} WHERE session_id=$${values.length - 1} AND tenant_id=$${values.length}`,
    values
  );
}
