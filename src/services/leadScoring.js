export function scoreLead({ case_type, urgency }) {
  let score = 50;
  if (case_type === 'traffic') score += 10;
  if (case_type === 'employment') score += 5;
  if (case_type === 'family') score += 3;
  if (urgency === 'hoch') score += 20;
  if (urgency === 'mittel') score += 10;
  if (urgency === 'niedrig') score -= 5;
  const tier = score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low';
  return { score, tier };
}
