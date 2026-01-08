import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

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

export async function classifyCaseType(text) {
  const caseType = heuristicCaseType(text);
  return {
    case_type: caseType,
    confidence: caseType === 'other' ? 0.5 : 0.78,
    rationale_short: 'Heuristic classification based on keywords.'
  };
}

export async function craftNextQuestion(context) {
  const { missingFields = [], state } = context;
  if (missingFields.length > 0) {
    return `Bitte ergänzen Sie: ${missingFields[0]}?`;
  }
  if (state === 'SUMMARY') {
    return 'Stimmt die Zusammenfassung so? (ja/nein)';
  }
  return 'Können Sie mir dazu noch mehr Details geben?';
}

export async function buildFinalSummary(data) {
  const parts = [];
  if (data.name) parts.push(`Name: ${data.name}`);
  if (data.phone) parts.push(`Telefon: ${data.phone}`);
  if (data.case_type) parts.push(`Falltyp: ${data.case_type}`);
  if (data.data?.details) parts.push(`Details: ${data.data.details}`);
  return parts.join(' | ');
}

export function getPrompt(name) {
  return loadPrompt(name);
}
