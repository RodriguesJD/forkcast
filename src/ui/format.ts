import type { Quantity } from '../domain/types';

/** Presentation-only rounding. Domain code never rounds. */
export function formatAmount(amount: number): string {
  const eighths = Math.round(amount * 8) / 8;
  if (Math.abs(eighths - amount) < 1e-6 && eighths !== 0) {
    const whole = Math.floor(eighths);
    const frac = eighths - whole;
    const names: Record<string, string> = {
      '0.125': '⅛',
      '0.25': '¼',
      '0.375': '⅜',
      '0.5': '½',
      '0.625': '⅝',
      '0.75': '¾',
      '0.875': '⅞',
    };
    const fracStr = names[String(frac)] ?? '';
    if (fracStr) return whole > 0 ? `${whole}${fracStr}` : fracStr;
    return String(whole);
  }
  return String(Math.round(amount * 100) / 100);
}

export function formatQuantity(q: Quantity): string {
  const unit = q.unit === 'each' ? '' : ` ${q.unit}`;
  return `${formatAmount(q.amount)}${unit}`;
}
