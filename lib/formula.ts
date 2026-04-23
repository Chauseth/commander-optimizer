import { ScryfallCard } from './scryfall';
import { Slot, SlotCounts } from './types';
import { DEFAULT_SLOT_COUNTS, GENERIC_SUBTYPES } from './slots';

export type Archetype =
  | 'stax'
  | 'spellslinger'
  | 'aristocrats'
  | 'reanimator'
  | 'lands'
  | 'control'
  | 'combo-tutor'
  | 'tokens'
  | 'wheel'
  | 'enchantress'
  | 'aura-voltron'
  | 'equipment-voltron'
  | 'blink'
  | 'tribal'
  | 'aggro-cheap'
  | 'lifegain'
  | '+1/+1-counters'
  | 'default';

// Modifiers : delta sur DEFAULT_SLOT_COUNTS pour chaque slot fonctionnel.
// `manaFix` est calculé séparément selon colorIdentity.length, pas ici.
type ArchetypeModifier = {
  ramp:         number;
  draw:         number;
  tutor:        number;
  spotRemoval:  number;
  counterspell: number;  // forcé à 0 si U absent de l'identité
  boardWipe:    number;
  protection:   number;
  finisher:     number;
  baseCurve:    number;
};

export const ARCHETYPE_MODIFIERS: Record<Archetype, ArchetypeModifier> = {
  'stax':              { ramp: +2, draw:  0, tutor: +1, spotRemoval: +2, counterspell: +1, boardWipe: +1, protection:  0, finisher:  0, baseCurve: 3.0 },
  'spellslinger':      { ramp:  0, draw: +2, tutor:  0, spotRemoval: +1, counterspell: +2, boardWipe:  0, protection:  0, finisher:  0, baseCurve: 2.7 },
  'aristocrats':       { ramp:  0, draw: +1, tutor: +1, spotRemoval: -1, counterspell:  0, boardWipe: -1, protection:  0, finisher:  0, baseCurve: 2.9 },
  'reanimator':        { ramp:  0, draw: +1, tutor: +2, spotRemoval:  0, counterspell:  0, boardWipe: -1, protection:  0, finisher: +1, baseCurve: 3.0 },
  'lands':             { ramp: +4, draw:  0, tutor: +1, spotRemoval: -2, counterspell:  0, boardWipe: -1, protection:  0, finisher:  0, baseCurve: 3.2 },
  'control':           { ramp: +1, draw: +2, tutor: +1, spotRemoval: +2, counterspell: +3, boardWipe: +1, protection: +1, finisher: +1, baseCurve: 3.3 },
  'combo-tutor':       { ramp: +1, draw: +2, tutor: +4, spotRemoval: -1, counterspell: +2, boardWipe: -2, protection:  0, finisher: +1, baseCurve: 2.7 },
  'tokens':            { ramp: -1, draw:  0, tutor:  0, spotRemoval: -1, counterspell:  0, boardWipe: -2, protection: +1, finisher:  0, baseCurve: 2.5 },
  'wheel':             { ramp:  0, draw: +2, tutor:  0, spotRemoval:  0, counterspell: +1, boardWipe: +1, protection:  0, finisher:  0, baseCurve: 2.8 },
  'enchantress':       { ramp: -1, draw: +2, tutor: +1, spotRemoval: -1, counterspell:  0, boardWipe: -1, protection: +1, finisher:  0, baseCurve: 2.5 },
  'aura-voltron':      { ramp: -3, draw:  0, tutor: +1, spotRemoval: -2, counterspell:  0, boardWipe: -3, protection: +3, finisher: -1, baseCurve: 2.2 },
  'equipment-voltron': { ramp: -2, draw:  0, tutor: +1, spotRemoval: -1, counterspell:  0, boardWipe: -2, protection: +3, finisher: -1, baseCurve: 2.4 },
  'blink':             { ramp:  0, draw: +1, tutor:  0, spotRemoval: -1, counterspell:  0, boardWipe:  0, protection:  0, finisher:  0, baseCurve: 3.0 },
  'tribal':            { ramp: -1, draw:  0, tutor:  0, spotRemoval: -1, counterspell:  0, boardWipe: -1, protection: +1, finisher:  0, baseCurve: 2.7 },
  'aggro-cheap':       { ramp:  0, draw:  0, tutor:  0, spotRemoval: -1, counterspell:  0, boardWipe: -2, protection: +1, finisher: -1, baseCurve: 2.3 },
  'lifegain':          { ramp:  0, draw:  0, tutor:  0, spotRemoval:  0, counterspell:  0, boardWipe:  0, protection:  0, finisher:  0, baseCurve: 2.9 },
  '+1/+1-counters':    { ramp:  0, draw:  0, tutor:  0, spotRemoval:  0, counterspell:  0, boardWipe:  0, protection:  0, finisher:  0, baseCurve: 2.9 },
  'default':           { ramp:  0, draw:  0, tutor:  0, spotRemoval:  0, counterspell:  0, boardWipe:  0, protection:  0, finisher:  0, baseCurve: 2.9 },
};

export function detectArchetype(commander: ScryfallCard, oracleTags: string[]): Archetype {
  const text = commander.oracle_text ?? '';
  const cmc = commander.cmc ?? 0;
  const tags = new Set(oracleTags);

  if (
    tags.has('stax') || tags.has('tax') ||
    /\bspells.{0,30}cost \{[1-9]\} more\b/i.test(text) ||
    /\bdoesn't untap\b/i.test(text) ||
    /\bdon't untap\b/i.test(text) ||
    /\bcan't attack (or|and can't) block\b/i.test(text)
  ) return 'stax';

  if (/\binstant\b.*\bsorcery\b/i.test(text) || /\bcopy target (instant|sorcery)\b/i.test(text) || tags.has('prowess')) {
    return 'spellslinger';
  }

  if (tags.has('sacrifice') && (tags.has('death-trigger') || tags.has('aristocrats'))) {
    return 'aristocrats';
  }

  if (tags.has('reanimate-creature') || tags.has('mill') || /\bfrom your graveyard\b/i.test(text)) {
    return 'reanimator';
  }

  if (
    tags.has('landfall') ||
    /\blandfall\b/i.test(text) ||
    /\bwhenever (a|one or more) lands? enters\b/i.test(text) ||
    /\byou may play (a |an |one |two |up to \w+ )?additional lands?\b/i.test(text)
  ) return 'lands';

  if (/\bcounter target\b/i.test(text) || (cmc >= 4 && /\bdraw\b.*\beach\b/i.test(text))) {
    return 'control';
  }

  if (cmc <= 4 && /\bsearch your library for a( |n )(card|creature|artifact)\b/i.test(text)) {
    return 'combo-tutor';
  }

  if (tags.has('token-generation') || /\bcreate\b.*\btoken\b/i.test(text)) {
    return 'tokens';
  }

  if (
    tags.has('wheel') ||
    /\beach (player|opponent) draws\b/i.test(text) ||
    /\bwhenever a player draws\b/i.test(text) ||
    /\beach player discards\b/i.test(text)
  ) return 'wheel';

  if (
    tags.has('enchantress') ||
    /\bwhenever you cast an enchantment\b/i.test(text) ||
    /\bwhenever an enchantment (enters|you control)\b/i.test(text)
  ) return 'enchantress';

  const hasAuraTag = tags.has('aura') || tags.has('voltron');
  const hasAuraText = /\baura\b/i.test(text) && (
    /\bsearch your library\b/i.test(text) ||
    /\bfor each aura\b/i.test(text) ||
    /\bwhenever you cast an? aura\b/i.test(text)
  );
  if (hasAuraTag || hasAuraText) return 'aura-voltron';

  if (
    tags.has('equipment') ||
    /\bfor each equipment\b/i.test(text) ||
    /\bwhenever.{0,40}equipped\b/i.test(text) ||
    /\bsearch your library for an? equipment\b/i.test(text) ||
    /\battach any number of.{0,40}equipment\b/i.test(text)
  ) return 'equipment-voltron';

  if (
    tags.has('blink') || tags.has('flicker') ||
    (/\bwhenever\b/i.test(text) && /\bexile\b/i.test(text) && /\breturn (it|them|those cards)\b.*\bbattlefield\b/i.test(text))
  ) return 'blink';

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

// Mana-fixing : 0 en mono, scale avec le nombre de couleurs
function manaFixCount(colorCount: number): number {
  if (colorCount <= 1) return 0;
  if (colorCount === 2) return 2;
  if (colorCount === 3) return 4;
  return 5;
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

  const colorIdentity = commander.color_identity ?? [];
  const colorCount = colorIdentity.length;
  const hasBlue = colorIdentity.includes('U');

  const extraRamp = Math.round(Math.max(0, estimatedAvgCmc - 2.8) * 3.0);
  const landsFromCurve = Math.round(31 + estimatedAvgCmc * 2.0);
  const colorDelta = colorLandsDelta(colorCount);

  const ramp       = clamp(DEFAULT_SLOT_COUNTS['ramp']         + extraRamp + modifier.ramp,         7, 15);
  const manaFix    = clamp(manaFixCount(colorCount),                                                0,  8);
  const draw       = clamp(DEFAULT_SLOT_COUNTS['draw']         + modifier.draw,                     7, 14);
  let tutor        = clamp(DEFAULT_SLOT_COUNTS['tutor']        + modifier.tutor,                    0,  8);
  let spotRemoval  = clamp(DEFAULT_SLOT_COUNTS['spot-removal'] + modifier.spotRemoval,              4, 12);
  let counterspell = hasBlue
    ? clamp(DEFAULT_SLOT_COUNTS['counterspell'] + modifier.counterspell, 0, 8)
    : 0;
  let boardWipe    = clamp(DEFAULT_SLOT_COUNTS['board-wipe']   + modifier.boardWipe,                1,  6);
  let protection   = clamp(DEFAULT_SLOT_COUNTS['protection']   + modifier.protection,               0,  6);
  let finisher     = clamp(DEFAULT_SLOT_COUNTS['finisher']     + modifier.finisher,                 0,  4);
  const totalLands = clamp(landsFromCurve + colorDelta, 33, 42);

  const sumNonSyn = ramp + manaFix + draw + tutor + spotRemoval + counterspell + boardWipe + protection + finisher;
  let synergy = 99 - (sumNonSyn + totalLands);

  // Garantir un minimum de 15 cartes synergie en grattant sur les slots les plus extensibles
  if (synergy < 15) {
    let deficit = 15 - synergy;
    const grabFrom = (current: number, min: number): [number, number] => {
      const grab = Math.min(deficit, current - min);
      return [Math.max(min, current - grab), Math.max(0, deficit - grab)];
    };
    [spotRemoval, deficit] = grabFrom(spotRemoval, 4);
    if (deficit > 0) [boardWipe,    deficit] = grabFrom(boardWipe,    1);
    if (deficit > 0) [tutor,        deficit] = grabFrom(tutor,        0);
    if (deficit > 0) [counterspell, deficit] = grabFrom(counterspell, 0);
    if (deficit > 0) [protection,   deficit] = grabFrom(protection,   0);
    if (deficit > 0) [finisher,     deficit] = grabFrom(finisher,     0);
    synergy = 99 - (ramp + manaFix + draw + tutor + spotRemoval + counterspell + boardWipe + protection + finisher + totalLands);
  }

  const counts: SlotCounts = {
    'ramp':         ramp,
    'mana-fix':     manaFix,
    'draw':         draw,
    'tutor':        tutor,
    'spot-removal': spotRemoval,
    'counterspell': counterspell,
    'board-wipe':   boardWipe,
    'protection':   protection,
    'finisher':     finisher,
    'synergy':      synergy,
    totalLands,
  };

  return { counts, archetype, estimatedAvgCmc };
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
  const newSynergy = counts.synergy - landDelta;
  return { ...counts, totalLands: newTotalLands, synergy: newSynergy };
}

// Helper pour itérer sur les slots non-terrains de SlotCounts
export const FUNCTIONAL_SLOTS: Slot[] = [
  'ramp', 'mana-fix', 'draw', 'tutor',
  'spot-removal', 'counterspell', 'board-wipe',
  'protection', 'finisher', 'synergy',
];
