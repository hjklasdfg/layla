function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function effectiveScore(value: number, invert: boolean): number {
  const v = clamp(value);
  return invert ? 100 - v : v;
}

export function getScoreColor(value: number, invert = false): string {
  const score = effectiveScore(value, invert);
  if (score >= 75) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

export function getScoreBarColor(value: number, invert = false): string {
  const score = effectiveScore(value, invert);
  if (score >= 75) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
}

export function getScoreLabel(value: number, invert = false): string {
  const score = effectiveScore(value, invert);
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  if (score >= 30) return "Poor";
  return "Critical";
}
