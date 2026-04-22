import { ScryfallCard } from './scryfall';
import { SlotCounts } from './types';
import { Archetype, ARCHETYPE_SLOT_QUERIES } from './formula';

export const MAX_BASIC_LANDS = 27;
export const MIN_BASIC_LANDS = 8; // Réservés pour les sorts de ramp (Cultivate, Farseek, Solemn Simulacrum...)

export const BASIC_LANDS: Record<string, string> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
};

export const BUDGET_WEIGHTS: Record<string, number> = {
  'Rampe': 1.5,
  'Pioche': 1.4,
  'Suppression': 1.2,
  'Balayage': 1.0,
  'Synergie': 1.3,
  'Terrains non basiques': 0.8,
};

export const DEFAULT_SLOT_COUNTS: SlotCounts = {
  Rampe: 10,
  Pioche: 10,
  Suppression: 8,
  Balayage: 3,
  Synergie: 31,
  totalLands: 37,
};

export const DECK_SLOTS: Array<{
  role: string;
  count: number;
  queries: ((ci: string) => string)[];
}> = [
  {
    role: 'Rampe',
    count: 10,
    queries: [
      (ci) => `o:"add {" type:artifact ${ci} format:commander`,
      (ci) => `o:"search your library" o:"land" type:sorcery ${ci} format:commander`,
      (ci) => `o:"add {" type:enchantment ${ci} format:commander`,
      (ci) => `o:"add {" type:creature ${ci} format:commander`,
      (ci) => `o:"search your library" o:"land" type:creature ${ci} format:commander`,
    ],
  },
  {
    role: 'Pioche',
    count: 10,
    queries: [
      (ci) => `o:"draw" o:"card" (type:instant OR type:sorcery) ${ci} format:commander`,
      (ci) => `o:"draw" o:"card" type:enchantment ${ci} format:commander`,
      (ci) => `o:"draw" o:"card" type:artifact ${ci} format:commander`,
      (ci) => `o:"draw" o:"card" type:creature ${ci} format:commander`,
    ],
  },
  {
    role: 'Suppression',
    count: 8,
    queries: [
      (ci) => `(o:"destroy target" OR o:"exile target") type:instant ${ci} format:commander`,
      (ci) => `(o:"destroy target" OR o:"exile target") type:sorcery ${ci} format:commander`,
      (ci) => `(o:"destroy target" OR o:"exile target") type:creature ${ci} format:commander`,
    ],
  },
  {
    role: 'Balayage',
    count: 3,
    queries: [
      (ci) => `o:"destroy all" type:sorcery ${ci} format:commander`,
      (ci) => `o:"all creatures" o:"destroy" type:sorcery ${ci} format:commander`,
      (ci) => `o:"exile all" type:sorcery ${ci} format:commander`,
      (ci) => `o:"destroy all" type:creature ${ci} format:commander`,
      (ci) => `o:"exile all" type:creature ${ci} format:commander`,
    ],
  },
  {
    role: 'Synergie',
    count: 31,
    queries: [
      (ci) => `type:creature ${ci} format:commander`,
    ],
  },
  {
    role: 'Terrains non basiques',
    count: 10,
    queries: [
      (ci) => `type:land -type:basic ${ci} format:commander`,
    ],
  },
];

// Sous-types trop larges pour être utiles comme indicateur tribal
export const GENERIC_SUBTYPES = new Set([
  'human', 'wizard', 'shaman', 'warrior', 'cleric',
  'rogue', 'knight', 'soldier', 'druid', 'monk',
]);

export function buildSynergyQueries(
  commander: ScryfallCard,
  oracleTags: string[]
): ((ci: string) => string)[] {
  const queries: ((ci: string) => string)[] = [];

  // Créatures synergiques en priorité (otag + type:creature)
  for (const tag of oracleTags.slice(0, 6)) {
    queries.push((ci) => `otag:${tag} type:creature ${ci} format:commander`);
  }

  // Non-créatures synergiques (Grave Pact, Ashnod's Altar...)
  for (const tag of oracleTags.slice(0, 4)) {
    queries.push((ci) => `otag:${tag} ${ci} format:commander`);
  }

  // Tribal : sous-types du type_line, en ignorant les types trop génériques
  const subtypePart = commander.type_line?.split('—')[1];
  if (subtypePart) {
    const subtypes = subtypePart.trim().split(/\s+/)
      .filter(s => s.length > 2 && !GENERIC_SUBTYPES.has(s.toLowerCase()));
    for (const subtype of subtypes.slice(0, 2)) {
      queries.push((ci) => `type:${subtype.toLowerCase()} ${ci} format:commander`);
    }
  }

  return queries;
}

export function buildArchetypeSlotQueries(
  archetype: Archetype,
  role: 'Rampe' | 'Pioche' | 'Suppression' | 'Balayage'
): ((ci: string) => string)[] {
  return ARCHETYPE_SLOT_QUERIES[archetype]?.[role] ?? [];
}
