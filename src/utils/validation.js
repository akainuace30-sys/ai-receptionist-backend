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
  return /^(\+?49|0)\d{6,}$/.test(cleaned) ? cleaned : null;
}

export function extractEmail(text) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

export function extractJurisdiction(text) {
  if (!text) return null;
  return text.trim();
}

export function normalizeUrgency(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes('hoch') || lower.includes('dringend')) return 'hoch';
  if (lower.includes('mittel')) return 'mittel';
  if (lower.includes('niedrig')) return 'niedrig';
  return text.trim();
}
