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

function normalizeJurisdiction(value) {
  if (!value) return null;
  const cleaned = value.toLowerCase().replace(/\s+/g, '-');
  const match = JURISDICTIONS.find((state) => cleaned.includes(state));
  return match || value.toLowerCase();
}

function parseAmount(value) {
  if (!value) return null;
  const numeric = value.toString().replace(/[^\d]/g, '');
  if (!numeric) return null;
  return Number(numeric);
}

function resolveTier(score) {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

function resolveRouting(tier) {
  if (tier === 'high') return 'priority';
  if (tier === 'medium') return 'standard';
  return 'follow_up';
}

export function computeLeadScore(intake) {
  const factors = {};
  let score = 0;

  const caseType = intake.case_type || intake.caseType || 'other';
  const baseScores = { traffic: 60, employment: 55, family: 50, other: 30 };
  score += baseScores[caseType] || 30;
  factors.case_type = caseType;

  const urgency = (intake.urgency || '').toLowerCase();
  if (urgency.includes('hoch') || urgency.includes('sofort') || urgency.includes('dringend')) {
    score += 20;
    factors.urgency = 'high';
  } else if (urgency.includes('mittel') || urgency.includes('bald')) {
    score += 10;
    factors.urgency = 'medium';
  } else {
    factors.urgency = urgency || 'unknown';
  }

  const jurisdiction = normalizeJurisdiction(intake.jurisdiction);
  if (jurisdiction && JURISDICTIONS.includes(jurisdiction)) {
    score += 10;
    factors.jurisdiction = 'in_de';
  } else if (jurisdiction) {
    score -= 10;
    factors.jurisdiction = 'out_of_scope';
  } else {
    factors.jurisdiction = 'unknown';
  }

  const amount = parseAmount(intake.data?.schadenhoehe || intake.data?.streitwert);
  if (amount) {
    factors.amount = amount;
    if (amount >= 10000) score += 10;
    if (amount >= 50000) score += 10;
  }

  const tier = resolveTier(score);
  const routing = resolveRouting(tier);

  return {
    score,
    tier,
    routing,
    factors
  };
}
