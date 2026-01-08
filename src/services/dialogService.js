import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/index.js';
import { classifyCaseType, buildFinalSummary } from './llmService.js';
import { isAffirmative, isNegative, normalizeName, extractPhone } from '../utils/validation.js';

const STATES = {
  CONSENT: 'CONSENT',
  NAME: 'NAME',
  NAME_CONFIRM: 'NAME_CONFIRM',
  PHONE: 'PHONE',
  PHONE_CONFIRM: 'PHONE_CONFIRM',
  DESCRIPTION: 'DESCRIPTION',
  CASE_DETAILS: 'CASE_DETAILS',
  SUMMARY: 'SUMMARY',
  SUMMARY_CONFIRM: 'SUMMARY_CONFIRM',
  DONE: 'DONE'
};

const CASE_FIELDS = {
  traffic: ['datum', 'ort', 'verletzungen', 'gegner_bekannt', 'polizei'],
  employment: ['datum', 'frist', 'arbeitgeber', 'status', 'dokumente'],
  family: ['thema', 'datum', 'kinder', 'dringlichkeit']
};

async function ensureSession(sessionId) {
  const pool = getPool();
  const id = sessionId || uuidv4();
  const { rows } = await pool.query('SELECT * FROM sessions WHERE id=$1', [id]);
  if (rows.length) return rows[0];
  await pool.query('INSERT INTO sessions (id, state, status) VALUES ($1,$2,$3)', [id, STATES.CONSENT, 'active']);
  await pool.query('INSERT INTO intakes (session_id, data, missing_fields, confidence) VALUES ($1,$2,$3,$4)', [
    id,
    {},
    JSON.stringify([]),
    JSON.stringify({})
  ]);
  return (await pool.query('SELECT * FROM sessions WHERE id=$1', [id])).rows[0];
}

async function appendMessage(sessionId, role, text) {
  const pool = getPool();
  await pool.query('INSERT INTO messages (id, session_id, role, text) VALUES ($1,$2,$3,$4)', [
    uuidv4(),
    sessionId,
    role,
    text
  ]);
}

function updateMissingFields(intake, state, caseType) {
  const missing = [];
  if (!intake.consent_given && state !== STATES.CONSENT) missing.push('consent');
  if (!intake.name && [STATES.PHONE, STATES.PHONE_CONFIRM, STATES.DESCRIPTION, STATES.CASE_DETAILS, STATES.SUMMARY].includes(state)) {
    missing.push('name');
  }
  if (!intake.phone && [STATES.DESCRIPTION, STATES.CASE_DETAILS, STATES.SUMMARY].includes(state)) {
    missing.push('phone');
  }
  if (!intake.data?.description && [STATES.CASE_DETAILS, STATES.SUMMARY].includes(state)) {
    missing.push('anliegen');
  }
  if (caseType && CASE_FIELDS[caseType]) {
    for (const field of CASE_FIELDS[caseType]) {
      if (!intake.data?.[field]) missing.push(field);
    }
  }
  return missing;
}

async function handleConsent({ text, session, intake }) {
  if (isNegative(text)) {
    await finalizeSession(session.id, 'abgelehnt');
    return {
      reply_text: 'Alles klar, wir beenden hier. Danke für Ihre Zeit.',
      state: STATES.DONE,
      done: true
    };
  }
  if (isAffirmative(text)) {
    await updateIntake(session.id, { consent_given: true });
    await updateSessionState(session.id, STATES.NAME);
    return { reply_text: 'Vielen Dank. Wie ist Ihr vollständiger Name?', state: STATES.NAME };
  }
  return { reply_text: 'Bitte bestätigen Sie: Einverstanden mit Aufzeichnung und Datenschutz? (ja/nein)', state: STATES.CONSENT };
}

async function handleName({ text, session, intake }) {
  const name = normalizeName(text);
  await updateIntake(session.id, { name });
  await updateSessionState(session.id, STATES.NAME_CONFIRM);
  return { reply_text: `Habe ich richtig verstanden, Ihr Name ist ${name}? (ja/nein)`, state: STATES.NAME_CONFIRM };
}

async function handleNameConfirm({ text, session, intake }) {
  if (isAffirmative(text)) {
    await updateSessionState(session.id, STATES.PHONE);
    return { reply_text: 'Bitte nennen Sie Ihre Telefonnummer (z. B. +49171...).', state: STATES.PHONE };
  }
  await updateIntake(session.id, { name: null });
  await updateSessionState(session.id, STATES.NAME);
  return { reply_text: 'Bitte nennen Sie Ihren vollständigen Namen.', state: STATES.NAME };
}

async function handlePhone({ text, session }) {
  const phone = extractPhone(text);
  if (!phone) {
    return { reply_text: 'Die Nummer wirkt nicht gültig. Bitte im Format +49 oder 0 beginnend angeben.', state: STATES.PHONE };
  }
  await updateIntake(session.id, { phone });
  await updateSessionState(session.id, STATES.PHONE_CONFIRM);
  return { reply_text: `Ist ${phone} korrekt? (ja/nein)`, state: STATES.PHONE_CONFIRM };
}

async function handlePhoneConfirm({ text, session }) {
  if (isAffirmative(text)) {
    await updateSessionState(session.id, STATES.DESCRIPTION);
    return { reply_text: 'Vielen Dank. Bitte schildern Sie kurz Ihr Anliegen.', state: STATES.DESCRIPTION };
  }
  await updateIntake(session.id, { phone: null });
  await updateSessionState(session.id, STATES.PHONE);
  return { reply_text: 'Bitte wiederholen Sie Ihre Telefonnummer.', state: STATES.PHONE };
}

async function handleDescription({ text, session, intake }) {
  const data = { ...(intake.data || {}), description: text.trim() };
  const classification = await classifyCaseType(text);
  await updateIntake(session.id, { data, case_type: classification.case_type, confidence: classification });
  await updateSession(session.id, { state: STATES.CASE_DETAILS, case_type: classification.case_type });
  const next = nextCaseQuestion(classification.case_type, data);
  return { reply_text: next, state: STATES.CASE_DETAILS, case_type: classification.case_type };
}

function nextCaseQuestion(caseType, data = {}) {
  const fields = CASE_FIELDS[caseType] || [];
  const missing = fields.filter((field) => !data[field]);
  if (!missing.length) return 'Gibt es noch etwas Wichtiges, das ich wissen sollte?';
  const field = missing[0];
  const questions = {
    datum: 'Wann ist das passiert? Bitte nennen Sie ein Datum.',
    ort: 'Wo ist es passiert? (Ort/Adresse)',
    verletzungen: 'Gab es Verletzungen? (ja/nein)',
    gegner_bekannt: 'Ist der Unfallgegner bekannt? (ja/nein)',
    polizei: 'War die Polizei vor Ort? (ja/nein)',
    frist: 'Haben Sie eine Frist genannt bekommen? Falls ja, welche?',
    arbeitgeber: 'Wie heißt der Arbeitgeber?',
    status: 'Ist es eine Kündigung oder Abmahnung? Was ist der aktuelle Status?',
    dokumente: 'Liegen Schriftstücke vor? (ja/nein)',
    thema: 'Worum geht es genau? (Sorgerecht, Trennung, Unterhalt, anderes)',
    kinder: 'Sind Kinder betroffen? Wenn ja, wie viele?',
    dringlichkeit: 'Wie dringend ist die Angelegenheit?',
    gegner: 'Wer ist die Gegenseite?'
  };
  return questions[field] || `Bitte teilen Sie ${field} mit.`;
}

async function handleCaseDetails({ text, session, intake }) {
  const caseType = intake.case_type || 'other';
  const data = { ...(intake.data || {}) };
  const caseFields = CASE_FIELDS[caseType] || [];
  for (const field of caseFields) {
    if (!data[field]) {
      data[field] = text.trim();
      break;
    }
  }
  await updateIntake(session.id, { data });
  const missing = caseFields.filter((f) => !data[f]);
  if (missing.length === 0) {
    await updateSessionState(session.id, STATES.SUMMARY);
    return await buildSummaryResponse({ session, intake: { ...intake, data } });
  }
  return { reply_text: nextCaseQuestion(caseType, data), state: STATES.CASE_DETAILS };
}

async function buildSummaryResponse({ session, intake }) {
  const summary = await buildFinalSummary({ ...intake, data: intake.data });
  await updateIntake(session.id, { summary });
  await updateSessionState(session.id, STATES.SUMMARY_CONFIRM);
  return { reply_text: `${summary}\nStimmt das so? (ja/nein)`, state: STATES.SUMMARY_CONFIRM };
}

async function handleSummaryConfirm({ text, session, intake }) {
  if (isAffirmative(text)) {
    await updateSessionState(session.id, STATES.DONE);
    await finalizeSession(session.id, 'completed');
    return {
      reply_text: 'Vielen Dank. Ihre Angaben wurden erfasst. Wir melden uns zeitnah.',
      state: STATES.DONE,
      done: true
    };
  }
  const data = { ...(intake.data || {}), corrections: text.trim() };
  await updateIntake(session.id, { data });
  return await buildSummaryResponse({ session, intake: { ...intake, data } });
}

async function finalizeSession(sessionId, status) {
  await updateSession(sessionId, { status, state: STATES.DONE });
}

async function updateIntake(sessionId, fields) {
  const pool = getPool();
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const assignments = keys.map((key, idx) => `${key}=$${idx + 1}`);
  const values = keys.map((k) => {
    const v = fields[k];
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) return JSON.stringify(v);
    return v;
  });
  values.push(sessionId);
  await pool.query(`UPDATE intakes SET ${assignments.join(', ')} WHERE session_id=$${values.length}`, values);
}

async function updateSessionState(sessionId, state) {
  await updateSession(sessionId, { state });
}

async function updateSession(sessionId, fields) {
  const pool = getPool();
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const assignments = keys.map((key, idx) => `${key}=$${idx + 1}`);
  const values = keys.map((k) => fields[k]);
  values.push(sessionId);
  await pool.query(`UPDATE sessions SET ${assignments.join(', ')} WHERE id=$${values.length}`, values);
}

async function getIntake(sessionId) {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM intakes WHERE session_id=$1', [sessionId]);
  return normalizeRecord(rows[0]);
}

export async function processDialog(input) {
  const { session_id: sessionId, text } = input;
  if (!text) {
    const error = { status: 400, body: { error: 'Missing text' } };
    throw error;
  }
  const session = await ensureSession(sessionId);
  const intake = await getIntake(session.id);
  await appendMessage(session.id, 'user', text);

  let response;
  switch (session.state) {
    case STATES.CONSENT:
      response = await handleConsent({ text, session, intake });
      break;
    case STATES.NAME:
      response = await handleName({ text, session, intake });
      break;
    case STATES.NAME_CONFIRM:
      response = await handleNameConfirm({ text, session, intake });
      break;
    case STATES.PHONE:
      response = await handlePhone({ text, session, intake });
      break;
    case STATES.PHONE_CONFIRM:
      response = await handlePhoneConfirm({ text, session, intake });
      break;
    case STATES.DESCRIPTION:
      response = await handleDescription({ text, session, intake });
      break;
    case STATES.CASE_DETAILS:
      response = await handleCaseDetails({ text, session, intake });
      break;
    case STATES.SUMMARY:
      response = await buildSummaryResponse({ session, intake });
      break;
    case STATES.SUMMARY_CONFIRM:
      response = await handleSummaryConfirm({ text, session, intake });
      break;
    default:
      response = { reply_text: 'Danke. Wir haben bereits alles Nötige.', state: STATES.DONE, done: true };
  }

  const updatedIntake = await getIntake(session.id);
  const missing_fields = updateMissingFields(updatedIntake, response.state, updatedIntake.case_type);
  await updateIntake(session.id, { missing_fields });

  const output = {
    session_id: session.id,
    reply_text: response.reply_text,
    state: response.state,
    case_type: updatedIntake.case_type,
    extracted_fields: {
      name: updatedIntake.name,
      phone: updatedIntake.phone,
      description: updatedIntake.data?.description,
      data: updatedIntake.data
    },
    missing_fields,
    done: Boolean(response.done)
  };

  await appendMessage(session.id, 'assistant', response.reply_text);
  return output;
}

export async function getSessionSnapshot(id) {
  const pool = getPool();
  const { rows: sessions } = await pool.query('SELECT * FROM sessions WHERE id=$1', [id]);
  if (!sessions.length) return null;
  const { rows: intakes } = await pool.query('SELECT * FROM intakes WHERE session_id=$1', [id]);
  const { rows: messages } = await pool.query('SELECT * FROM messages WHERE session_id=$1 ORDER BY created_at', [id]);
  return { session: sessions[0], intake: normalizeRecord(intakes[0]), messages };
}

export async function submitIntake(id) {
  await updateIntake(id, { submitted_to_make: true, submitted_at: new Date().toISOString() });
  return getSessionSnapshot(id);
}

export { STATES };

function normalizeRecord(record) {
  if (!record) return record;
  const jsonFields = ['data', 'missing_fields', 'confidence'];
  for (const field of jsonFields) {
    if (typeof record[field] === 'string') {
      try {
        record[field] = JSON.parse(record[field]);
      } catch (err) {
        // keep as is
      }
    }
  }
  return record;
}
