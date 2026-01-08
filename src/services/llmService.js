import fs from 'fs';
import path from 'path';
import url from 'url';
import Ajv from 'ajv';
import { classifySchema, nextQuestionSchema, summarySchema } from '../utils/llmSchemas.js';
import { LLMError } from '../utils/errors.js';

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
  const caseType = heuristicCaseType(text);
  const payload = {
    case_type: caseType,
    confidence: caseType === 'other' ? 0.5 : 0.78,
    rationale_short: 'Heuristic classification based on keywords.'
  };
  return validateOutput(validateClassify, payload, 'classification');
}

export async function craftNextQuestion(context) {
  const { missingFields = [], state } = context;
  let question = 'Können Sie mir dazu noch mehr Details geben?';
  if (missingFields.length > 0) {
    question = `Bitte ergänzen Sie: ${missingFields[0]}?`;
  } else if (state === 'SUMMARY') {
    question = 'Stimmt die Zusammenfassung so? (ja/nein)';
  }
  const payload = { question };
  return validateOutput(validateNextQuestion, payload, 'next_question');
}

export async function buildFinalSummary(data) {
  const parts = [];
  if (data.name) parts.push(`Name: ${data.name}`);
  if (data.phone) parts.push(`Telefon: ${data.phone}`);
  if (data.email) parts.push(`E-Mail: ${data.email}`);
  if (data.jurisdiction) parts.push(`Jurisdiktion: ${data.jurisdiction}`);
  if (data.case_type) parts.push(`Falltyp: ${data.case_type}`);
  if (data.urgency) parts.push(`Dringlichkeit: ${data.urgency}`);
  if (data.data?.description) parts.push(`Anliegen: ${data.data.description}`);
  return validateOutput(validateSummary, { summary: parts.join(' | ') }, 'summary');
}

export function getPrompt(name) {
  return loadPrompt(name);
}

export function getPromptMeta(name) {
  return PROMPTS[name];
}
