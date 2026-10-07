import { describe, expect, it } from 'vitest';
import type { Quantity } from './types';
import {
  add,
  canMerge,
  chooseDisplayUnit,
  convert,
  fromBase,
  isUnit,
  toBase,
  unitFamily,
} from './units';

describe('unitFamily', () => {
  it('classifies every unit', () => {
    expect(unitFamily('tsp')).toBe('volume');
    expect(unitFamily('floz')).toBe('volume');
    expect(unitFamily('l')).toBe('volume');
    expect(unitFamily('oz')).toBe('mass');
    expect(unitFamily('kg')).toBe('mass');
    expect(unitFamily('clove')).toBe('count');
    expect(unitFamily('each')).toBe('count');
  });

  it('recognises known unit strings', () => {
    expect(isUnit('cup')).toBe(true);
    expect(isUnit('cups')).toBe(false);
    expect(isUnit('')).toBe(false);
  });
});

describe('canMerge', () => {
  it('merges within volume and within mass, across systems', () => {
    expect(canMerge('tsp', 'cup')).toBe(true);
    expect(canMerge('cup', 'ml')).toBe(true);
    expect(canMerge('oz', 'kg')).toBe(true);
  });

  it('never merges volume with mass, including oz vs floz', () => {
    expect(canMerge('cup', 'g')).toBe(false);
    expect(canMerge('oz', 'floz')).toBe(false);
  });

  it('merges count units only when identical', () => {
    expect(canMerge('clove', 'clove')).toBe(true);
    expect(canMerge('clove', 'head')).toBe(false);
    expect(canMerge('each', 'can')).toBe(false);
    expect(canMerge('each', 'g')).toBe(false);
  });
});

describe('convert', () => {
  it('uses exact US customary ratios', () => {
    expect(convert({ amount: 3, unit: 'tsp' }, 'tbsp')!.amount).toBeCloseTo(1, 12);
    expect(convert({ amount: 16, unit: 'tbsp' }, 'cup')!.amount).toBeCloseTo(1, 12);
    expect(convert({ amount: 2, unit: 'tbsp' }, 'floz')!.amount).toBeCloseTo(1, 12);
    expect(convert({ amount: 16, unit: 'oz' }, 'lb')!.amount).toBeCloseTo(1, 12);
  });

  it('uses exact metric ratios', () => {
    expect(convert({ amount: 1000, unit: 'g' }, 'kg')!.amount).toBe(1);
    expect(convert({ amount: 2.5, unit: 'l' }, 'ml')!.amount).toBe(2500);
  });

  it('converts across systems with NIST factors', () => {
    expect(convert({ amount: 1, unit: 'cup' }, 'ml')!.amount).toBeCloseTo(236.588, 3);
    expect(convert({ amount: 1, unit: 'lb' }, 'g')!.amount).toBeCloseTo(453.592, 3);
    expect(convert({ amount: 100, unit: 'g' }, 'oz')!.amount).toBeCloseTo(3.5274, 4);
  });

  it('is an identity for the same unit', () => {
    expect(convert({ amount: 2.5, unit: 'each' }, 'each')).toEqual({ amount: 2.5, unit: 'each' });
  });

  it('returns null for incompatible units', () => {
    expect(convert({ amount: 2, unit: 'cup' }, 'g')).toBeNull();
    expect(convert({ amount: 2, unit: 'clove' }, 'head')).toBeNull();
  });

  it('round-trips without drift beyond float tolerance', () => {
    const start = { amount: 0.3, unit: 'cup' as const };
    const there = convert(start, 'ml')!;
    const back = convert(there, 'cup')!;
    expect(back.amount).toBeCloseTo(0.3, 12);
  });
});

describe('add', () => {
  it('sums in the unit of the first operand', () => {
    expect(add({ amount: 1, unit: 'tbsp' }, { amount: 3, unit: 'tsp' })).toEqual({
      amount: expect.closeTo(2, 12),
      unit: 'tbsp',
    });
    expect(add({ amount: 1, unit: 'tsp' }, { amount: 1, unit: 'tbsp' })!.amount).toBeCloseTo(4, 12);
  });

  it('returns null across families', () => {
    expect(add({ amount: 2, unit: 'cup' }, { amount: 300, unit: 'g' })).toBeNull();
  });

  it('accumulates ten thirds of a cup to 3 1/3 cups', () => {
    let total: Quantity = { amount: 0, unit: 'cup' };
    for (let i = 0; i < 10; i++) total = add(total, { amount: 1 / 3, unit: 'cup' })!;
    expect(total.amount).toBeCloseTo(10 / 3, 10);
  });
});

describe('chooseDisplayUnit', () => {
  const base = (amount: number, unit: Parameters<typeof toBase>[0]['unit']) => toBase({ amount, unit });

  it('climbs the US volume ladder', () => {
    expect(chooseDisplayUnit(base(2, 'tsp'), 'tsp')).toBe('tsp');
    expect(chooseDisplayUnit(base(3, 'tsp'), 'tsp')).toBe('tbsp');
    expect(chooseDisplayUnit(base(15, 'tbsp'), 'tbsp')).toBe('tbsp');
    expect(chooseDisplayUnit(base(16, 'tbsp'), 'tbsp')).toBe('cup');
    expect(chooseDisplayUnit(base(0.5, 'tsp'), 'cup')).toBe('tsp');
  });

  it('stays in the preferred system', () => {
    expect(chooseDisplayUnit(base(1, 'cup'), 'ml')).toBe('ml');
    expect(chooseDisplayUnit(base(5, 'cup'), 'l')).toBe('l');
    expect(chooseDisplayUnit(base(500, 'ml'), 'cup')).toBe('cup');
  });

  it('climbs the mass ladders', () => {
    expect(chooseDisplayUnit(base(999, 'g'), 'g')).toBe('g');
    expect(chooseDisplayUnit(base(1500, 'g'), 'g')).toBe('kg');
    expect(chooseDisplayUnit(base(15, 'oz'), 'oz')).toBe('oz');
    expect(chooseDisplayUnit(base(20, 'oz'), 'oz')).toBe('lb');
    expect(chooseDisplayUnit(base(0.2, 'oz'), 'lb')).toBe('oz');
  });

  it('never picks floz', () => {
    expect(chooseDisplayUnit(base(3, 'floz'), 'floz')).toBe('tbsp');
  });

  it('keeps count units as they are', () => {
    expect(chooseDisplayUnit(7, 'clove')).toBe('clove');
  });
});

describe('fromBase', () => {
  it('inverts toBase', () => {
    const q = { amount: 1.25, unit: 'lb' as const };
    expect(fromBase(toBase(q), 'lb').amount).toBeCloseTo(1.25, 12);
    expect(fromBase(toBase(q), 'oz').amount).toBeCloseTo(20, 12);
  });
});
