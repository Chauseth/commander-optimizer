import { Slot, SlotCounts } from './types';

const SLOT_KEYS: Slot[] = [
  'ramp',
  'mana-fix',
  'draw',
  'tutor',
  'spot-removal',
  'counterspell',
  'board-wipe',
  'protection',
  'finisher',
  'synergy',
];

const SLOT_LIMITS: Record<Slot | 'totalLands', { min: number; max: number }> = {
  ramp: { min: 0, max: 20 },
  'mana-fix': { min: 0, max: 8 },
  draw: { min: 0, max: 20 },
  tutor: { min: 0, max: 8 },
  'spot-removal': { min: 0, max: 15 },
  counterspell: { min: 0, max: 8 },
  'board-wipe': { min: 0, max: 10 },
  protection: { min: 0, max: 6 },
  finisher: { min: 0, max: 4 },
  synergy: { min: 5, max: 50 },
  totalLands: { min: 28, max: 45 },
};

export interface GenerateDeckInput {
  commanderName: string;
  budget: number;
  slotCounts?: SlotCounts;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readInteger(value: unknown, key: string): number {
  const numberValue = typeof value === 'string' ? Number(value) : value;
  if (typeof numberValue !== 'number' || !Number.isFinite(numberValue)) {
    throw new ValidationError(`Slot invalide: ${key}`);
  }
  return Math.round(numberValue);
}

export function sanitizeSlotCounts(value: unknown): SlotCounts | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) throw new ValidationError('Slots invalides');

  const counts = {} as SlotCounts;
  for (const key of SLOT_KEYS) {
    if (!(key in value)) throw new ValidationError(`Slot manquant: ${key}`);
    const limits = SLOT_LIMITS[key];
    counts[key] = clamp(readInteger(value[key], key), limits.min, limits.max);
  }

  if (!('totalLands' in value)) throw new ValidationError('Slot manquant: totalLands');
  const landLimits = SLOT_LIMITS.totalLands;
  counts.totalLands = clamp(readInteger(value.totalLands, 'totalLands'), landLimits.min, landLimits.max);

  const total = SLOT_KEYS.reduce((sum, key) => sum + counts[key], counts.totalLands);
  if (total !== 99) {
    throw new ValidationError(`Distribution invalide: ${total}/99 cartes`);
  }

  return counts;
}

export function parseGenerateDeckInput(body: unknown): GenerateDeckInput {
  if (!isObject(body)) throw new ValidationError('Requete invalide');

  const commanderName = typeof body.commanderName === 'string' ? body.commanderName.trim() : '';
  if (!commanderName) throw new ValidationError('Commander manquant');

  const budget = typeof body.budget === 'string' ? Number(body.budget.trim()) : body.budget;
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 10) {
    throw new ValidationError('Budget invalide (minimum 10 EUR)');
  }

  return {
    commanderName,
    budget,
    slotCounts: sanitizeSlotCounts(body.slotCounts),
  };
}
