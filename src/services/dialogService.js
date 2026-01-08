import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/index.js';
import { classifyCaseType, buildFinalSummary, craftNextQuestion } from './llmService.js';
import {
  isAffirmative,
  isNegative,
  normalizeName,
  extractPhone,
  extractEmail,
  extractJurisdiction,
  normalizeUrgency
} from '../utils/validation.js';
import { UserError, SystemError } from '../utils/errors.js';
import { getContext, logger } from './logger.js';
import { computeLeadScore } from './leadScoring.js';
import { metrics } from './metrics.js';

const STATES = {
  CONSENT: 'CONSENT',
  NAME: 'NAME',
  NAME_CONFIRM: 'NAME_CONFIRM',
  PHONE: 'PHONE',
  PHONE_CONFIRM: 'PHONE_CONFIRM',
  EMAIL: 'EMAIL',
  EMAIL_CONFIRM: 'EMAIL_CONFIRM',
  JURISDICTION: 'JURISDICTION',
  DESCRIPTION: 'DESCRIPTION',
  URGENCY: 'URGENCY',
  CASE_DETAILS: 'CASE_DETAILS',
  SUMMARY: 'SUMMARY',
  SUMMARY_CONFIRM: 'SUMMARY_CONFIRM',
  DONE: 'DONE'
};

const CASE_FIELDS = {
  traffic: ['datum', 'ort', 'verletzungen', 'gegner_bekannt', 'polizei', 'schadenhoehe'],
  employment: ['datum', 'frist', 'arbeitgeber', 'status', 'dokumente', 'streitwert'],
  family: ['thema', 'datum', 'kinder', 'dringlichkeit_detail']
};

const CASE_QUESTIONS = {
  datum: 'Wann ist das passiert? Bitte nennen Sie ein Datum.',
  ort: 'Wo ist es passiert? (Ort/Adresse)',
  verletzungen: 'Gab es Verletzungen? (ja/nein)',
  gegner_bekannt: 'Ist der Unfallgegner bekannt? (ja/nein)',
  polizei: 'War die Polizei vor Ort? (ja/nein)',
  schadenhoehe: 'Wie hoch ist die ungefähre Schadenhöhe?',
  frist: 'Haben Sie eine Frist genannt bekommen? Falls ja, welche?',
  arbeitgeber: 'Wie heißt der Arbeitgeber?',
  status: 'Ist es eine Kündigung oder Abmahnung? Was ist der aktuelle Status?',
  dokumente: 'Liegen Schriftstücke vor? (ja/nein)',
  streitwert: 'Gibt es einen Streitwert oder eine Einschätzung zur Höhe?',
  thema: 'Worum geht es genau? (Sorgerecht, Trennung, Unterhalt, anderes)',
  kinder: 'Sind Kinder betroffen? Wenn ja, wie viele?',
  dringlichkeit_detail: 'Gibt es besondere Fristen oder Eilbedarf im Familienrecht?'
};

const MAX_RETRIES = 2;

async function ensureSession(sessionId, tenantId) {
  const pool = getPool();
  const id = sessionId || uuidv4();
  const { rows } = await pool.query('SELECT * FROM sessions WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL', [
    id,
    tenantId
  ]);
  if (rows.length) return rows[0];
  if (sessionId) {
    throw new UserError('Session not found', 404, {}, 'SESSION_NOT_FOUND');
  }
  await pool.query('INSERT INTO sessions (id, tenant_id, state, status) VALUES ($1,$2,$3,$4)', [
    id,
    tenantId,
    STATES.CONSENT,
    'active'
  ]);
  await pool.query(
    'INSERT INTO intakes (session_id, tenant_id, data, missing_fields, confidence) VALUES ($1,$2,$3,$4,$5)',
    [id, tenantId, JSON.stringify({ _meta: { retries: {} } }), JSON.stringify([]), JSON.stringify({})]
  );
  await recordTransition(id, tenantId, null, STATES.CONSENT, 'session_created');
  return (
    await pool.query('SELECT * FROM sessions WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL', [id, tenantId])
  ).rows[0];
}

async function appendMessage(sessionId, tenantId, role, text) {
  const pool = getPool();
  await pool.query('INSERT INTO messages (id, tenant_id, session_id, role, text) VALUES ($1,$2,$3,$4,$5)', [
    uuidv4(),
    tenantId,
    sessionId,
    role,
    text
  ]);
}

async function recordConsent({ sessionId, tenantId, consented, channel, consentText, ipAddress, userAgent }) {
  const pool = getPool();
  await pool.query(
    'INSERT INTO consents (id, tenant_id, session_id, channel, consent_text, consented, consented_at, ip_address, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      uuidv4(),
      tenantId,
      sessionId,
      channel || 'api',
      consentText,
      consented,
      new Date().toISOString(),
      ipAddress || null,
      userAgent || null
    ]
  );
}

async function recordTransition(sessionId, tenantId, fromState, toState, reason) {
  const pool = getPool();
  await pool.query(
    'INSERT INTO session_transitions (id, tenant_id, session_id, from_state, to_state, reason) VALUES ($1,$2,$3,$4,$5,$6)',
    [uuidv4(), tenantId, sessionId, fromState, toState, reason]
  );
}

function updateMissingFields(intake, state, caseType) {
  const missing = [];
  if (!intake.consent_given) missing.push('consent');
  if (!intake.name) missing.push('name');
  if (!intake.phone) missing.push('phone');
  if (!intake.email && !intake.data?.email_missing_reason) missing.push('email');
  if (!intake.jurisdiction) missing.push('jurisdiction');
  if (!intake.case_type) missing.push('case_type');
  if (!intake.data?.description) missing.push('anliegen');
  if (!intake.urgency) missing.push('urgency');
  if (caseType && CASE_FIELDS[caseType]) {
    for (const field of CASE_FIELDS[caseType]) {
      if (!intake.data?.[field]) missing.push(field);
    }
  }
  if (state === STATES.DONE) return [];
  return missing;
}

async function incrementRetry(sessionId, intake, key) {
  const meta = intake.data?._meta || { retries: {} };
  const retries = { ...(meta.retries || {}) };
  retries[key] = (retries[key] || 0) + 1;
  await updateIntake(sessionId, { data: { ...(intake.data || {}), _meta: { ...meta, retries } } }, intake.tenant_id);
  return retries[key];
}

async function handleConsent({ text, session, intake, context, tenantId }) {
  const consentText = 'Ich stimme der Verarbeitung meiner Angaben gemäß DSGVO zu.';
  if (isNegative(text)) {
    await recordConsent({ sessionId: session.id, tenantId, consented: false, consentText, ...context });
    await updateSessionState(session.id, tenantId, STATES.DONE, 'consent_declined');
    await finalizeSession(session.id, tenantId, 'abgelehnt');
    return {
      reply_text: 'Alles klar, wir beenden hier. Danke für Ihre Zeit.',
      state: STATES.DONE,
      done: true
    };
  }
  if (isAffirmative(text)) {
    await updateIntake(session.id, { consent_given: true, consent_at: new Date().toISOString() }, tenantId);
    await recordConsent({ sessionId: session.id, tenantId, consented: true, consentText, ...context });
    await updateSessionState(session.id, tenantId, STATES.NAME, 'consent_accepted');
    return { reply_text: 'Vielen Dank. Wie ist Ihr vollständiger Name?', state: STATES.NAME };
  }
  return {
    reply_text: 'Bitte bestätigen Sie: Einverstanden mit Aufzeichnung und Datenschutz? (ja/nein)',
    state: STATES.CONSENT
  };
}

async function handleName({ text, session, intake, tenantId }) {
  const name = normalizeName(text);
  if (!name || name.length < 3) {
    const retries = await incrementRetry(session.id, intake, 'name');
    if (retries >= MAX_RETRIES) {
      return { reply_text: 'Bitte nennen Sie Ihren vollständigen Namen, inklusive Nachname.', state: STATES.NAME };
    }
    return { reply_text: 'Ich habe den Namen nicht verstanden. Bitte wiederholen Sie ihn.', state: STATES.NAME };
  }
  await updateIntake(session.id, { name }, tenantId);
  await updateSessionState(session.id, tenantId, STATES.NAME_CONFIRM, 'name_captured');
  return { reply_text: `Habe ich richtig verstanden, Ihr Name ist ${name}? (ja/nein)`, state: STATES.NAME_CONFIRM };
}

async function handleNameConfirm({ text, session, tenantId }) {
  if (isAffirmative(text)) {
    await updateSessionState(session.id, tenantId, STATES.PHONE, 'name_confirmed');
    return { reply_text: 'Bitte nennen Sie Ihre Telefonnummer (z. B. +49171...).', state: STATES.PHONE };
  }
  await updateIntake(session.id, { name: null }, tenantId);
  await updateSessionState(session.id, tenantId, STATES.NAME, 'name_rejected');
  return { reply_text: 'Bitte nennen Sie Ihren vollständigen Namen.', state: STATES.NAME };
}

async function handlePhone({ text, session, intake, tenantId }) {
  const phone = extractPhone(text);
  if (!phone) {
    const retries = await incrementRetry(session.id, intake, 'phone');
    if (retries >= MAX_RETRIES) {
      return { reply_text: 'Bitte im Format +49 oder 0 beginnend angeben, z. B. +491701234567.', state: STATES.PHONE };
    }
    return { reply_text: 'Die Nummer wirkt nicht gültig. Bitte erneut angeben.', state: STATES.PHONE };
  }
  await updateIntake(session.id, { phone }, tenantId);
  await updateSessionState(session.id, tenantId, STATES.PHONE_CONFIRM, 'phone_captured');
  return { reply_text: `Ist ${phone} korrekt? (ja/nein)`, state: STATES.PHONE_CONFIRM };
}

async function handlePhoneConfirm({ text, session, tenantId }) {
  if (isAffirmative(text)) {
    await updateSessionState(session.id, tenantId, STATES.EMAIL, 'phone_confirmed');
    return { reply_text: 'Bitte nennen Sie Ihre E-Mail-Adresse. Falls keine vorhanden, schreiben Sie "keine".', state: STATES.EMAIL };
  }
  await updateIntake(session.id, { phone: null }, tenantId);
  await updateSessionState(session.id, tenantId, STATES.PHONE, 'phone_rejected');
  return { reply_text: 'Bitte wiederholen Sie Ihre Telefonnummer.', state: STATES.PHONE };
}

function isNoEmail(text) {
  return /keine|kein|nicht vorhanden|habe keine/i.test(text || '');
}

async function handleEmail({ text, session, intake, tenantId }) {
  if (isNoEmail(text)) {
    const data = { ...(intake.data || {}), email_missing_reason: 'keine' };
    await updateIntake(session.id, { email: null, data }, tenantId);
    await updateSessionState(session.id, tenantId, STATES.JURISDICTION, 'email_skipped');
    return { reply_text: 'Verstanden. In welchem Bundesland (Jurisdiktion) ist der Fall?', state: STATES.JURISDICTION };
  }
  const email = extractEmail(text);
  if (!email) {
    const retries = await incrementRetry(session.id, intake, 'email');
    if (retries >= MAX_RETRIES) {
      return { reply_text: 'Bitte geben Sie eine gültige E-Mail an, z. B. name@example.de.', state: STATES.EMAIL };
    }
    return { reply_text: 'Die E-Mail-Adresse wirkt nicht gültig. Bitte erneut angeben.', state: STATES.EMAIL };
  }
  await updateIntake(session.id, { email }, tenantId);
  await updateSessionState(session.id, tenantId, STATES.EMAIL_CONFIRM, 'email_captured');
  return { reply_text: `Ist ${email} korrekt? (ja/nein)`, state: STATES.EMAIL_CONFIRM };
}

async function handleEmailConfirm({ text, session, tenantId }) {
  if (isAffirmative(text)) {
    await updateSessionState(session.id, tenantId, STATES.JURISDICTION, 'email_confirmed');
    return { reply_text: 'In welchem Bundesland (Jurisdiktion) ist der Fall?', state: STATES.JURISDICTION };
  }
  await updateIntake(session.id, { email: null }, tenantId);
  await updateSessionState(session.id, tenantId, STATES.EMAIL, 'email_rejected');
  return { reply_text: 'Bitte nennen Sie Ihre E-Mail-Adresse.', state: STATES.EMAIL };
}

async function handleJurisdiction({ text, session, intake, tenantId }) {
  const jurisdiction = extractJurisdiction(text);
  if (!jurisdiction) {
    const retries = await incrementRetry(session.id, intake, 'jurisdiction');
    if (retries >= MAX_RETRIES) {
      return { reply_text: 'Bitte nennen Sie das Bundesland, z. B. Nordrhein-Westfalen.', state: STATES.JURISDICTION };
    }
    return { reply_text: 'Ich habe das Bundesland nicht erkannt. Bitte erneut angeben.', state: STATES.JURISDICTION };
  }
  await updateIntake(session.id, { jurisdiction }, tenantId);
  await updateSessionState(session.id, tenantId, STATES.DESCRIPTION, 'jurisdiction_captured');
  return { reply_text: 'Bitte schildern Sie kurz Ihr Anliegen.', state: STATES.DESCRIPTION };
}

async function handleDescription({ text, session, intake, tenantId }) {
  const description = text.trim();
  if (!description) {
    return { reply_text: 'Bitte schildern Sie Ihr Anliegen mit wenigen Sätzen.', state: STATES.DESCRIPTION };
  }
  const data = { ...(intake.data || {}), description };
  const classification = await classifyCaseType(description);
  await updateIntake(session.id, { data, case_type: classification.case_type, confidence: classification }, tenantId);
  await updateSession(session.id, tenantId, { state: STATES.URGENCY, case_type: classification.case_type });
  await recordTransition(session.id, tenantId, STATES.DESCRIPTION, STATES.URGENCY, 'description_captured');
  return { reply_text: 'Wie dringend ist die Angelegenheit? (niedrig/mittel/hoch)', state: STATES.URGENCY };
}

async function handleUrgency({ text, session, intake, tenantId }) {
  const urgency = normalizeUrgency(text);
  if (!urgency) {
    const retries = await incrementRetry(session.id, intake, 'urgency');
    if (retries >= MAX_RETRIES) {
      return { reply_text: 'Bitte wählen Sie: niedrig, mittel oder hoch.', state: STATES.URGENCY };
    }
    return { reply_text: 'Ich habe die Dringlichkeit nicht verstanden. Bitte erneut angeben.', state: STATES.URGENCY };
  }
  await updateIntake(session.id, { urgency }, tenantId);
  await updateSessionState(session.id, tenantId, STATES.CASE_DETAILS, 'urgency_captured');
  const nextQuestion = await nextCaseQuestion(intake.case_type, intake.data || {});
  return { reply_text: nextQuestion, state: STATES.CASE_DETAILS };
}

async function nextCaseQuestion(caseType, data = {}) {
  const fields = CASE_FIELDS[caseType] || [];
  const missing = fields.filter((field) => !data[field]);
  if (!missing.length) {
    const llmQuestion = await craftNextQuestion({ missingFields: [], state: STATES.SUMMARY });
    return llmQuestion.question;
  }
  const field = missing[0];
  const question = CASE_QUESTIONS[field] || `Bitte teilen Sie ${field} mit.`;
  return question;
}

async function handleCaseDetails({ text, session, intake, tenantId }) {
  const caseType = intake.case_type || 'other';
  const data = { ...(intake.data || {}) };
  const caseFields = CASE_FIELDS[caseType] || [];
  for (const field of caseFields) {
    if (!data[field]) {
      data[field] = text.trim();
      break;
    }
  }
  await updateIntake(session.id, { data }, tenantId);
  const missing = caseFields.filter((f) => !data[f]);
  if (missing.length === 0) {
    await updateSessionState(session.id, tenantId, STATES.SUMMARY, 'case_details_complete');
    return await buildSummaryResponse({ session, intake: { ...intake, data }, tenantId });
  }
  return { reply_text: await nextCaseQuestion(caseType, data), state: STATES.CASE_DETAILS };
}

async function buildSummaryResponse({ session, intake, tenantId }) {
  const summaryPayload = await buildFinalSummary({ ...intake, data: intake.data });
  await updateIntake(session.id, { summary: summaryPayload.summary }, tenantId);
  await updateSessionState(session.id, tenantId, STATES.SUMMARY_CONFIRM, 'summary_built');
  return { reply_text: `${summaryPayload.summary}\nStimmt das so? (ja/nein)`, state: STATES.SUMMARY_CONFIRM };
}

async function handleSummaryConfirm({ text, session, intake, tenantId }) {
  if (isAffirmative(text)) {
    await updateSessionState(session.id, tenantId, STATES.DONE, 'summary_confirmed');
    await finalizeSession(session.id, tenantId, 'completed');
    return {
      reply_text: 'Vielen Dank. Ihre Angaben wurden erfasst. Wir melden uns zeitnah.',
      state: STATES.DONE,
      done: true
    };
  }
  const data = { ...(intake.data || {}), corrections: text.trim() };
  await updateIntake(session.id, { data }, tenantId);
  return await buildSummaryResponse({ session, intake: { ...intake, data }, tenantId });
}

async function finalizeSession(sessionId, tenantId, status) {
  await updateSession(sessionId, tenantId, { status });
}

async function updateIntake(sessionId, fields, tenantId) {
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
  values.push(sessionId, tenantId);
  await pool.query(
    `UPDATE intakes SET ${assignments.join(', ')} WHERE session_id=$${values.length - 1} AND tenant_id=$${values.length}`,
    values
  );
}

async function updateSessionState(sessionId, tenantId, state, reason) {
  const pool = getPool();
  const { rows } = await pool.query('SELECT state FROM sessions WHERE id=$1 AND tenant_id=$2', [sessionId, tenantId]);
  const fromState = rows[0]?.state || null;
  if (fromState) {
    const { rows: lastTransitions } = await pool.query(
      'SELECT created_at FROM session_transitions WHERE session_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 1',
      [sessionId, tenantId]
    );
    const lastTransitionAt = lastTransitions[0]?.created_at;
    if (lastTransitionAt) {
      const duration = Date.now() - new Date(lastTransitionAt).getTime();
      metrics.increment(`state.duration_ms.${fromState.toLowerCase()}`, duration);
    }
  }
  await updateSession(sessionId, tenantId, { state });
  await recordTransition(sessionId, tenantId, fromState, state, reason || 'state_change');
  metrics.increment(`state.transition.${fromState || 'none'}.${state}`);
}

async function updateSession(sessionId, tenantId, fields) {
  const pool = getPool();
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const assignments = keys.map((key, idx) => `${key}=$${idx + 1}`);
  const values = keys.map((k) => fields[k]);
  values.push(sessionId, tenantId);
  await pool.query(
    `UPDATE sessions SET ${assignments.join(', ')} WHERE id=$${values.length - 1} AND tenant_id=$${values.length}`,
    values
  );
}

async function getIntake(sessionId, tenantId) {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM intakes WHERE session_id=$1 AND tenant_id=$2 AND deleted_at IS NULL',
    [sessionId, tenantId]
  );
  return normalizeRecord(rows[0]);
}

async function updateLeadScore(sessionId, tenantId, intake) {
  const score = computeLeadScore(intake);
  await updateIntake(
    sessionId,
    {
      lead_score: score.score,
      lead_tier: score.tier,
      lead_routing: score.routing
    },
    tenantId
  );
  const pool = getPool();
  await pool.query(
    'INSERT INTO lead_scores (id, tenant_id, session_id, score, tier, routing, factors) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [uuidv4(), tenantId, sessionId, score.score, score.tier, score.routing, JSON.stringify(score.factors)]
  );
  return score;
}

export async function processDialog(input) {
  const { session_id: sessionId, text, context = {}, tenant_id: tenantId } = input;
  if (!text) {
    throw new UserError('Missing text', 400, {}, 'VALIDATION_MISSING_TEXT');
  }
  if (!tenantId) {
    throw new SystemError('Missing tenant context', {}, 'TENANT_MISSING');
  }
  const session = await ensureSession(sessionId, tenantId);
  const logContext = getContext();
  if (logContext) {
    logContext.session_id = session.id;
    logContext.tenant_id = tenantId;
  }
  const intake = await getIntake(session.id, tenantId);
  if (!intake) {
    throw new SystemError('Intake not found', { session_id: session.id }, 'INTAKE_NOT_FOUND');
  }
  await appendMessage(session.id, tenantId, 'user', text);

  let response;
  switch (session.state) {
    case STATES.CONSENT:
      response = await handleConsent({ text, session, intake, context, tenantId });
      break;
    case STATES.NAME:
      response = await handleName({ text, session, intake, tenantId });
      break;
    case STATES.NAME_CONFIRM:
      response = await handleNameConfirm({ text, session, intake, tenantId });
      break;
    case STATES.PHONE:
      response = await handlePhone({ text, session, intake, tenantId });
      break;
    case STATES.PHONE_CONFIRM:
      response = await handlePhoneConfirm({ text, session, intake, tenantId });
      break;
    case STATES.EMAIL:
      response = await handleEmail({ text, session, intake, tenantId });
      break;
    case STATES.EMAIL_CONFIRM:
      response = await handleEmailConfirm({ text, session, intake, tenantId });
      break;
    case STATES.JURISDICTION:
      response = await handleJurisdiction({ text, session, intake, tenantId });
      break;
    case STATES.DESCRIPTION:
      response = await handleDescription({ text, session, intake, tenantId });
      break;
    case STATES.URGENCY:
      response = await handleUrgency({ text, session, intake, tenantId });
      break;
    case STATES.CASE_DETAILS:
      response = await handleCaseDetails({ text, session, intake, tenantId });
      break;
    case STATES.SUMMARY:
      response = await buildSummaryResponse({ session, intake, tenantId });
      break;
    case STATES.SUMMARY_CONFIRM:
      response = await handleSummaryConfirm({ text, session, intake, tenantId });
      break;
    default:
      response = { reply_text: 'Danke. Wir haben bereits alles Nötige.', state: STATES.DONE, done: true };
  }

  const updatedIntake = await getIntake(session.id, tenantId);
  const missing_fields = updateMissingFields(updatedIntake, response.state, updatedIntake.case_type);
  await updateIntake(session.id, { missing_fields }, tenantId);
  const score = await updateLeadScore(session.id, tenantId, updatedIntake);

  const output = {
    session_id: session.id,
    reply_text: response.reply_text,
    state: response.state,
    case_type: updatedIntake.case_type,
    extracted_fields: {
      name: updatedIntake.name,
      phone: updatedIntake.phone,
      email: updatedIntake.email,
      jurisdiction: updatedIntake.jurisdiction,
      description: updatedIntake.data?.description,
      urgency: updatedIntake.urgency,
      data: sanitizeDataForOutput(updatedIntake.data)
    },
    missing_fields,
    lead_score: score.score,
    lead_tier: score.tier,
    lead_routing: score.routing,
    done: Boolean(response.done)
  };

  await appendMessage(session.id, tenantId, 'assistant', response.reply_text);
  logger.info('dialog_processed', {
    session_id: session.id,
    state: response.state,
    done: Boolean(response.done)
  });
  metrics.increment(`dialog.state.${response.state.toLowerCase()}`);
  if (response.done) {
    metrics.increment('dialog.completed');
  }
  return output;
}

export async function getSessionSnapshot(id, tenantId) {
  const pool = getPool();
  const { rows: sessions } = await pool.query(
    'SELECT * FROM sessions WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',
    [id, tenantId]
  );
  if (!sessions.length) return null;
  const { rows: intakes } = await pool.query(
    'SELECT * FROM intakes WHERE session_id=$1 AND tenant_id=$2 AND deleted_at IS NULL',
    [id, tenantId]
  );
  const { rows: messages } = await pool.query(
    'SELECT * FROM messages WHERE session_id=$1 AND tenant_id=$2 AND deleted_at IS NULL ORDER BY created_at',
    [id, tenantId]
  );
  const { rows: transitions } = await pool.query(
    'SELECT * FROM session_transitions WHERE session_id=$1 AND tenant_id=$2 AND deleted_at IS NULL ORDER BY created_at',
    [id, tenantId]
  );
  const { rows: consents } = await pool.query(
    'SELECT * FROM consents WHERE session_id=$1 AND tenant_id=$2 AND deleted_at IS NULL ORDER BY created_at',
    [id, tenantId]
  );
  const { rows: leadScores } = await pool.query(
    'SELECT * FROM lead_scores WHERE session_id=$1 AND tenant_id=$2 AND deleted_at IS NULL ORDER BY created_at',
    [id, tenantId]
  );
  return { session: sessions[0], intake: normalizeRecord(intakes[0]), messages, transitions, consents, lead_scores: leadScores };
}

export async function submitIntake(id, tenantId) {
  await updateIntake(id, { submitted_to_make: true, submitted_at: new Date().toISOString() }, tenantId);
  return getSessionSnapshot(id, tenantId);
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

function sanitizeDataForOutput(data) {
  if (!data) return data;
  const cloned = { ...data };
  delete cloned._meta;
  return cloned;
}
