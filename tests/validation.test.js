import { extractEmail, extractPhone, extractJurisdiction, normalizeUrgency } from '../src/utils/validation.js';

describe('Validation helpers', () => {
  test('extracts valid phone', () => {
    expect(extractPhone('+491701234567')).toBe('+491701234567');
    expect(extractPhone('0170 1234567')).toBe('01701234567');
  });

  test('extracts valid email', () => {
    expect(extractEmail('Kontakt: test@example.de')).toBe('test@example.de');
  });

  test('extracts jurisdiction', () => {
    expect(extractJurisdiction('Nordrhein-Westfalen')).toBe('nordrhein-westfalen');
  });

  test('normalizes urgency', () => {
    expect(normalizeUrgency('hoch')).toBe('hoch');
    expect(normalizeUrgency('sehr dringend')).toBe('hoch');
  });
});
