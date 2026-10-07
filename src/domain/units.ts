import type { Quantity, Unit, UnitFamily } from './types';

/**
 * Unit conversion.
 *
 * Each family has one base unit: ml for volume, g for mass, the unit itself for counts.
 * US customary factors (NIST): 1 tsp = 4.92892 ml, 1 cup = 236.588 ml, 1 oz = 28.3495 g.
 * Volume and mass never convert to each other; that requires per-ingredient density.
 */

const VOLUME_TO_ML: Record<string, number> = {
  tsp: 4.92892159375,
  tbsp: 14.78676478125, // exactly 3 tsp
  floz: 29.5735295625, // exactly 2 tbsp
  cup: 236.5882365, // exactly 16 tbsp
  ml: 1,
  l: 1000,
};

const MASS_TO_G: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237, // exactly 16 oz
};

export const VOLUME_UNITS: readonly Unit[] = ['tsp', 'tbsp', 'floz', 'cup', 'ml', 'l'];
export const MASS_UNITS: readonly Unit[] = ['g', 'kg', 'oz', 'lb'];
export const COUNT_UNITS: readonly Unit[] = [
  'each',
  'clove',
  'can',
  'bunch',
  'slice',
  'stalk',
  'head',
  'sprig',
  'pinch',
];
export const ALL_UNITS: readonly Unit[] = [...VOLUME_UNITS, ...MASS_UNITS, ...COUNT_UNITS];

export function isUnit(value: string): value is Unit {
  return (ALL_UNITS as readonly string[]).includes(value);
}

export function unitFamily(unit: Unit): UnitFamily {
  if (unit in VOLUME_TO_ML) return 'volume';
  if (unit in MASS_TO_G) return 'mass';
  return 'count';
}

/** Factor from `unit` to its family's base unit. Count units have factor 1. */
export function toBaseFactor(unit: Unit): number {
  return VOLUME_TO_ML[unit] ?? MASS_TO_G[unit] ?? 1;
}

/** Amount expressed in the family base unit (ml, g, or count). */
export function toBase(q: Quantity): number {
  return q.amount * toBaseFactor(q.unit);
}

/**
 * Two quantities can be summed when they share a volume or mass family,
 * or when they are the identical count unit. "2 cloves" and "1 head" never merge.
 */
export function canMerge(a: Unit, b: Unit): boolean {
  const fa = unitFamily(a);
  const fb = unitFamily(b);
  if (fa !== fb) return false;
  if (fa === 'count') return a === b;
  return true;
}

/** Convert `q` to `to`. Returns null when the units cannot merge. */
export function convert(q: Quantity, to: Unit): Quantity | null {
  if (!canMerge(q.unit, to)) return null;
  if (q.unit === to) return { amount: q.amount, unit: to };
  return { amount: (q.amount * toBaseFactor(q.unit)) / toBaseFactor(to), unit: to };
}

/** Sum two quantities in the unit of `a`. Returns null when they cannot merge. */
export function add(a: Quantity, b: Quantity): Quantity | null {
  const converted = convert(b, a.unit);
  if (converted === null) return null;
  return { amount: a.amount + converted.amount, unit: a.unit };
}

export function scaleQuantity(q: Quantity, factor: number): Quantity {
  return { amount: q.amount * factor, unit: q.unit };
}

/** True when a unit is metric (ml, l, g, kg). Count units are neither system. */
export function isMetric(unit: Unit): boolean {
  return unit === 'ml' || unit === 'l' || unit === 'g' || unit === 'kg';
}

/** Ladders from small to large, per family and system. */
const LADDERS: Record<string, Unit[]> = {
  'volume-us': ['tsp', 'tbsp', 'cup'],
  'volume-metric': ['ml', 'l'],
  'mass-us': ['oz', 'lb'],
  'mass-metric': ['g', 'kg'],
};

/**
 * Pick a display unit for `baseAmount` (in the family base unit).
 *
 * Rule: stay in the measurement system of `preferred`, then choose the largest
 * unit on that system's ladder where the amount is at least 1. Below the
 * smallest rung, use the smallest rung. Count units display as themselves.
 * `floz` is deliberately not on the ladder; recipes rarely shop in fluid ounces.
 */
export function chooseDisplayUnit(baseAmount: number, preferred: Unit): Unit {
  const family = unitFamily(preferred);
  if (family === 'count') return preferred;
  const ladder = LADDERS[`${family}-${isMetric(preferred) ? 'metric' : 'us'}`];
  let chosen = ladder[0];
  for (const unit of ladder) {
    if (baseAmount / toBaseFactor(unit) >= 1) chosen = unit;
  }
  return chosen;
}

/** Express a base amount in a given unit. */
export function fromBase(baseAmount: number, unit: Unit): Quantity {
  return { amount: baseAmount / toBaseFactor(unit), unit };
}

/**
 * Count units describe whole things you buy (3 onions, 2 cans). Round a count
 * quantity up to a whole number; volume and mass pass through unchanged.
 * A tiny epsilon stops 2.0000000001 from becoming 3.
 */
export function ceilCount(q: Quantity): Quantity {
  if (unitFamily(q.unit) !== 'count') return q;
  return { amount: Math.ceil(q.amount - 1e-9), unit: q.unit };
}
