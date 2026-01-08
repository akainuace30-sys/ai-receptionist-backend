function classifyHeuristic(text) {
  const lower = text.toLowerCase();
  if (lower.includes('unfall') || lower.includes('verkehr') || lower.includes('auto')) return 'traffic';
  if (lower.includes('kündigung') || lower.includes('arbeit') || lower.includes('abmahnung')) return 'employment';
  if (lower.includes('familie') || lower.includes('sorgerecht') || lower.includes('unterhalt')) return 'family';
  return 'other';
}

export async function classifyCaseType(text) {
  const caseType = classifyHeuristic(text);
  return { case_type: caseType, confidence: caseType === 'other' ? 0.5 : 0.8 };
}

export async function buildSummary(intake) {
  const parts = [];
  if (intake.name) parts.push(`Name: ${intake.name}`);
  if (intake.phone) parts.push(`Telefon: ${intake.phone}`);
  if (intake.email) parts.push(`E-Mail: ${intake.email}`);
  if (intake.jurisdiction) parts.push(`Jurisdiktion: ${intake.jurisdiction}`);
  if (intake.case_type) parts.push(`Falltyp: ${intake.case_type}`);
  if (intake.urgency) parts.push(`Dringlichkeit: ${intake.urgency}`);
  if (intake.description) parts.push(`Anliegen: ${intake.description}`);
  return parts.join(' | ');
}
