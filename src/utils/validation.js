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
