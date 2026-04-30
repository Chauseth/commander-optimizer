import { describe, expect, it } from 'vitest';
import { parseGenerateDeckInput, sanitizeSlotCounts, ValidationError } from './validation';

const validCounts = {
  ramp: 10,
  'mana-fix': 2,
  draw: 10,
  tutor: 2,
  'spot-removal': 7,
  counterspell: 0,
  'board-wipe': 3,
  protection: 2,
  finisher: 1,
  synergy: 25,
  totalLands: 37,
};

describe('generate deck validation', () => {
  it('trims commander names and parses numeric budgets', () => {
    expect(parseGenerateDeckInput({
      commanderName: '  Atraxa  ',
      budget: '100',
    })).toEqual({
      commanderName: 'Atraxa',
      budget: 100,
      slotCounts: undefined,
    });
  });

  it('rejects missing commanders and too-small budgets', () => {
    expect(() => parseGenerateDeckInput({ commanderName: ' ', budget: 100 })).toThrow(ValidationError);
    expect(() => parseGenerateDeckInput({ commanderName: 'Atraxa', budget: 9 })).toThrow(ValidationError);
  });

  it('clamps slot values before validating the total', () => {
    expect(sanitizeSlotCounts({
      ...validCounts,
      ramp: 999,
      tutor: 4,
      synergy: -20,
      totalLands: 47,
    })).toMatchObject({
      ramp: 20,
      tutor: 4,
      synergy: 5,
      totalLands: 45,
    });
  });

  it('rejects custom slot distributions that do not produce 99 cards', () => {
    expect(() => sanitizeSlotCounts({ ...validCounts, synergy: 20 })).toThrow('Distribution invalide');
  });
});
