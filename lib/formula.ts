import { ScryfallCard } from './scryfall';
import { SlotCounts } from './types';
import { DEFAULT_SLOT_COUNTS, GENERIC_SUBTYPES } from './slots';

export type Archetype =
  | 'stax'
  | 'spellslinger'
  | 'aristocrats'
  | 'reanimator'
  | 'control'
  | 'combo-tutor'
  | 'tokens'
  | 'tribal'
  | 'aggro-cheap'
  | 'lifegain'
  | '+1/+1-counters'
  | 'aura-voltron'
  | 'default';

interface ArchetypeModifier {
  rampe: number;
  pioche: number;
  suppression: number;
  balayage: number;
  baseCurve: number;
}

export const ARCHETYPE_MODIFIERS: Record<Archetype, ArchetypeModifier> = {
  'stax':            { rampe:  0, pioche:  0, suppression: +2, balayage: +1, baseCurve: 3.0 },
  'spellslinger':    { rampe:  0, pioche: +2, suppression: +1, balayage:  0, baseCurve: 2.7 },
  'aristocrats':     { rampe:  0, pioche: +1, suppression: -1, balayage: -1, baseCurve: 2.9 },
  'reanimator':      { rampe:  0, pioche: +1, suppression:  0, balayage: -1, baseCurve: 3.0 },
  'control':         { rampe: +1, pioche: +2, suppression: +2, balayage: +1, baseCurve: 3.3 },
  'combo-tutor':     { rampe: +1, pioche: +2, suppression: -1, balayage: -2, baseCurve: 2.7 },
  'tokens':          { rampe: -1, pioche:  0, suppression: -1, balayage: -2, baseCurve: 2.5 },
  'tribal':          { rampe: -1, pioche:  0, suppression: -1, balayage: -1, baseCurve: 2.7 },
  'aggro-cheap':     { rampe:  0, pioche:  0, suppression: -1, balayage: -2, baseCurve: 2.3 },
  'lifegain':        { rampe:  0, pioche:  0, suppression:  0, balayage:  0, baseCurve: 2.9 },
  '+1/+1-counters':  { rampe:  0, pioche:  0, suppression:  0, balayage:  0, baseCurve: 2.9 },
  'aura-voltron':    { rampe: -3, pioche:  0, suppression: -2, balayage: -3, baseCurve: 2.2 },
  'default':         { rampe:  0, pioche:  0, suppression:  0, balayage:  0, baseCurve: 2.9 },
};

export function detectArchetype(commander: ScryfallCard, oracleTags: string[]): Archetype {
  const text = commander.oracle_text ?? '';
  const cmc = commander.cmc ?? 0;
  const tags = new Set(oracleTags);

  if (/\bcan't\b/i.test(text) || /\bdoesn't untap\b/i.test(text) || /\bpay \{[0-9]\}\b/.test(text)) {
    return 'stax';
  }

  if (/\binstant\b.*\bsorcery\b/i.test(text) || /\bcopy target (instant|sorcery)\b/i.test(text) || tags.has('prowess')) {
    return 'spellslinger';
  }

  if (tags.has('sacrifice') && (tags.has('death-trigger') || tags.has('aristocrats'))) {
    return 'aristocrats';
  }

  if (tags.has('reanimate-creature') || tags.has('mill') || /\bfrom your graveyard\b/i.test(text)) {
    return 'reanimator';
  }

  if (/\bcounter target\b/i.test(text) || (cmc >= 4 && /\bdraw\b.*\beach\b/i.test(text))) {
    return 'control';
  }

  if (cmc <= 4 && /\bsearch your library for a( |n )(card|creature|artifact)\b/i.test(text)) {
    return 'combo-tutor';
  }

  if (tags.has('token-generation') || /\bcreate\b.*\btoken\b/i.test(text)) {
    return 'tokens';
  }

  // Aura-voltron : commander qui tutore des auras ou grossit grâce aux auras
  const hasAuraTag = tags.has('aura') || tags.has('voltron');
  const hasAuraText = /\baura\b/i.test(text) && (
    /\bsearch your library\b/i.test(text) ||
    /\bfor each aura\b/i.test(text) ||
    /\bwhenever you cast an? aura\b/i.test(text)
  );
  if (hasAuraTag || hasAuraText) return 'aura-voltron';

  const subtypePart = commander.type_line?.split('—')[1];
  if (subtypePart) {
    const subtypes = subtypePart.trim().split(/\s+/)
      .filter(s => s.length > 2 && !GENERIC_SUBTYPES.has(s.toLowerCase()));
    if (subtypes.length > 0) return 'tribal';
  }

  if (cmc <= 3 && (/\bhaste\b/i.test(text) || (tags.has('+1/+1-counters') && commander.type_line?.includes('Creature')))) {
    return 'aggro-cheap';
  }

  if (tags.has('lifegain')) return 'lifegain';
  if (tags.has('+1/+1-counters')) return '+1/+1-counters';

  return 'default';
}

export function getMinBasicLands(colorCount: number): number {
  if (colorCount <= 1) return 18;
  if (colorCount === 2) return 12;
  if (colorCount === 3) return 8;
  if (colorCount === 4) return 6;
  return 4;
}

export function estimateAvgCmc(archetype: Archetype, commander: ScryfallCard): number {
  const base = ARCHETYPE_MODIFIERS[archetype].baseCurve;
  const commanderCmc = commander.cmc ?? 4;
  const tilt = Math.max(0, (commanderCmc - 4) * 0.10);
  return Math.min(4.0, Math.max(2.1, base + tilt));
}

function colorLandsDelta(colorCount: number): number {
  if (colorCount <= 1) return -1;
  if (colorCount === 2) return 0;
  if (colorCount === 3) return 0;
  return 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface ComputedSlots {
  counts: SlotCounts;
  archetype: Archetype;
  estimatedAvgCmc: number;
}

export function computeSlotCounts(commander: ScryfallCard, oracleTags: string[]): ComputedSlots {
  const archetype = detectArchetype(commander, oracleTags);
  const modifier = ARCHETYPE_MODIFIERS[archetype];
  const estimatedAvgCmc = estimateAvgCmc(archetype, commander);

  const extraRamp = Math.round(Math.max(0, estimatedAvgCmc - 2.8) * 3.0);
  const landsFromCurve = Math.round(31 + estimatedAvgCmc * 2.0);
  const colorCount = commander.color_identity?.length ?? 0;
  const colorDelta = colorLandsDelta(colorCount);

  let Rampe       = clamp(DEFAULT_SLOT_COUNTS.Rampe + extraRamp + modifier.rampe, 7, 15);
  let Pioche      = clamp(DEFAULT_SLOT_COUNTS.Pioche + modifier.pioche, 7, 14);
  let Suppression = clamp(DEFAULT_SLOT_COUNTS.Suppression + modifier.suppression, 4, 12);
  let Balayage    = clamp(DEFAULT_SLOT_COUNTS.Balayage + modifier.balayage, 1, 6);
  const totalLands = clamp(landsFromCurve + colorDelta, 33, 42);

  let Synergie = 99 - (Rampe + Pioche + Suppression + Balayage + totalLands);

  if (Synergie < 15) {
    const deficit = 15 - Synergie;
    const fromSuppr = Math.min(deficit, Suppression - 4);
    Suppression -= fromSuppr;
    const stillNeeded = deficit - fromSuppr;
    if (stillNeeded > 0) {
      const fromBalay = Math.min(stillNeeded, Balayage - 1);
      Balayage -= fromBalay;
    }
    Synergie = 99 - (Rampe + Pioche + Suppression + Balayage + totalLands);
  }

  return {
    counts: { Rampe, Pioche, Suppression, Balayage, Synergie, totalLands },
    archetype,
    estimatedAvgCmc,
  };
}

export function adjustLandsForActualCurve(
  counts: SlotCounts,
  estimatedAvgCmc: number,
  actualAvgCmc: number
): SlotCounts {
  const diff = actualAvgCmc - estimatedAvgCmc;
  let delta = 0;
  if (diff > 0.4) delta = 1;
  else if (diff < -0.4) delta = -1;
  if (delta === 0) return counts;

  const newTotalLands = clamp(counts.totalLands + delta, 33, 42);
  if (newTotalLands === counts.totalLands) return counts;

  const landDelta = newTotalLands - counts.totalLands;
  const newSynergie = counts.Synergie - landDelta;
  return { ...counts, totalLands: newTotalLands, Synergie: newSynergie };
}
