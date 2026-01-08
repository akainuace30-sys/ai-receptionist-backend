export function isAffirmative(text = '') {
  return /^(ja|yes|yep|einverstanden)/i.test(text.trim());
}

export function isNegative(text = '') {
  return /^(nein|no|nicht)/i.test(text.trim());
}

export function normalizeName(text) {
  return text.trim().replace(/\s+/g, ' ');
}

export function extractPhone(text) {
  const match = text.match(/(\+?\d[\d\s\/-]{6,})/);
  if (!match) return null;
  const cleaned = match[1].replace(/[\s\/-]/g, '');
  if (/^(\+?49|0)\d{6,}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

export function extractEmail(text) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

export function normalizeJurisdiction(text) {
  if (!text) return null;
  return text.trim().toLowerCase();
}

export function normalizeUrgency(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes('sofort') || lower.includes('dringend') || lower.includes('hoch')) return 'hoch';
  if (lower.includes('mittel') || lower.includes('bald')) return 'mittel';
  if (lower.includes('niedrig') || lower.includes('egal') || lower.includes('später')) return 'niedrig';
  return text.trim();
}

const JURISDICTIONS = [
  'baden-württemberg',
  'bayern',
  'berlin',
  'brandenburg',
  'bremen',
  'hamburg',
  'hessen',
  'mecklenburg-vorpommern',
  'niedersachsen',
  'nordrhein-westfalen',
  'rheinland-pfalz',
  'saarland',
  'sachsen',
  'sachsen-anhalt',
  'schleswig-holstein',
  'thüringen'
];

export function extractJurisdiction(text) {
  if (!text) return null;
  const cleaned = text.toLowerCase().replace(/\s+/g, '-');
  const match = JURISDICTIONS.find((state) => cleaned.includes(state));
  return match || null;
}
