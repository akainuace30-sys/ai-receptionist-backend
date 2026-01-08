import fs from 'fs';
import path from 'path';
import url from 'url';
import Ajv from 'ajv';
import { classifySchema, nextQuestionSchema, summarySchema } from '../utils/llmSchemas.js';
import { LLMError } from '../utils/errors.js';
import { logger } from './logger.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const PROMPTS = {
  classify_case_type: { filename: 'classify_case_type.prompt', version: 'v1', maxTokens: 200 },
  next_question: { filename: 'next_question.prompt', version: 'v1', maxTokens: 160 },
  final_summary: { filename: 'final_summary.prompt', version: 'v1', maxTokens: 240 }
};

const ajv = new Ajv({ allErrors: true });
const validateClassify = ajv.compile(classifySchema);
const validateNextQuestion = ajv.compile(nextQuestionSchema);
const validateSummary = ajv.compile(summarySchema);

const circuit = {
  failures: 0,
  openedAt: null
};
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;

function circuitOpen() {
  if (!circuit.openedAt) return false;
  return Date.now() - circuit.openedAt < CIRCUIT_COOLDOWN_MS;
}

async function withRetry(fn, { attempts = 2, delayMs = 100 } = {}) {
  let lastError;
  if (circuitOpen()) {
    throw new LLMError('LLM circuit open', {}, 'LLM_CIRCUIT_OPEN');
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await fn();
      circuit.failures = 0;
      circuit.openedAt = null;
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  circuit.failures += 1;
  if (circuit.failures >= CIRCUIT_THRESHOLD) {
    circuit.openedAt = Date.now();
  }
  throw lastError;
}

function loadPrompt(filename) {
  const filePath = path.resolve(__dirname, `../prompts/${filename}`);
  return fs.readFileSync(filePath, 'utf-8');
}

function heuristicCaseType(text) {
  const lower = text.toLowerCase();
  if (lower.includes('unfall') || lower.includes('verkehr') || lower.includes('auto') || lower.includes('polizei')) {
    return 'traffic';
  }
  if (lower.includes('kündigung') || lower.includes('arbeit') || lower.includes('abmahnung')) {
    return 'employment';
  }
  if (lower.includes('familie') || lower.includes('sorgerecht') || lower.includes('unterhalt') || lower.includes('trennung')) {
    return 'family';
  }
  return 'other';
}

function validateOutput(validator, payload, name) {
  if (!validator(payload)) {
    throw new LLMError(`Invalid ${name} output`, { errors: validator.errors });
  }
  return payload;
}

export async function classifyCaseType(text) {
  const started = Date.now();
  const result = await withRetry(async () => {
    const caseType = heuristicCaseType(text);
    const payload = {
      case_type: caseType,
      confidence: caseType === 'other' ? 0.5 : 0.78,
      rationale_short: 'Heuristic classification based on keywords.'
    };
    return validateOutput(validateClassify, payload, 'classification');
  });
  logger.info('llm_classify_latency_ms', { duration_ms: Date.now() - started });
  return result;
}

export async function craftNextQuestion(context) {
  const started = Date.now();
  const result = await withRetry(async () => {
    const { missingFields = [], state } = context;
    let question = 'Können Sie mir dazu noch mehr Details geben?';
    if (missingFields.length > 0) {
      question = `Bitte ergänzen Sie: ${missingFields[0]}?`;
    } else if (state === 'SUMMARY') {
      question = 'Stimmt die Zusammenfassung so? (ja/nein)';
    }
    const payload = { question };
    return validateOutput(validateNextQuestion, payload, 'next_question');
  });
  logger.info('llm_question_latency_ms', { duration_ms: Date.now() - started });
  return result;
}

export async function buildFinalSummary(data) {
  const started = Date.now();
  const result = await withRetry(async () => {
    const parts = [];
    if (data.name) parts.push(`Name: ${data.name}`);
    if (data.phone) parts.push(`Telefon: ${data.phone}`);
    if (data.email) parts.push(`E-Mail: ${data.email}`);
    if (data.jurisdiction) parts.push(`Jurisdiktion: ${data.jurisdiction}`);
    if (data.case_type) parts.push(`Falltyp: ${data.case_type}`);
    if (data.urgency) parts.push(`Dringlichkeit: ${data.urgency}`);
    if (data.data?.description) parts.push(`Anliegen: ${data.data.description}`);
    return validateOutput(validateSummary, { summary: parts.join(' | ') }, 'summary');
  });
  logger.info('llm_summary_latency_ms', { duration_ms: Date.now() - started });
  return result;
}

export function getPrompt(name) {
  return loadPrompt(name);
}

export function getPromptMeta(name) {
  return PROMPTS[name];
}
