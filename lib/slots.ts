import { ScryfallCard } from './scryfall';
import { Slot, SlotCounts } from './types';

export const MAX_BASIC_LANDS = 27;
export const MIN_BASIC_LANDS = 8;

export const BASIC_LANDS: Record<string, string> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
};

// Labels FR exposés à l'UI (clés byRole, ROLE_ICONS, etc.)
export const SLOT_LABEL_FR: Record<Slot, string> = {
  'ramp':         'Rampe',
  'mana-fix':     'Mana-fixing',
  'draw':         'Pioche',
  'tutor':        'Tuteurs',
  'spot-removal': 'Suppression',
  'counterspell': 'Contresorts',
  'board-wipe':   'Balayage',
  'protection':   'Protection',
  'finisher':     'Finisher',
  'synergy':      'Synergie',
};

export const NONBASIC_LAND_LABEL = 'Terrains non basiques';
export const BASIC_LAND_LABEL    = 'Terrains basiques';

// Pondération budget par carte (multiplicatif sur prix moyen)
export const BUDGET_WEIGHTS: Record<Slot | 'nonbasic-land', number> = {
  'ramp':         1.5,
  'mana-fix':     1.2,
  'draw':         1.4,
  'tutor':        1.6,
  'spot-removal': 1.2,
  'counterspell': 1.3,
  'board-wipe':   1.0,
  'protection':   1.1,
  'finisher':     1.4,
  'synergy':      1.3,
  'nonbasic-land': 0.8,
};

export const DEFAULT_SLOT_COUNTS: SlotCounts = {
  'ramp':         10,
  'mana-fix':      0,
  'draw':         10,
  'tutor':         0,
  'spot-removal':  7,
  'counterspell':  0,
  'board-wipe':    3,
  'protection':    2,
  'finisher':      1,
  'synergy':      26,
  totalLands:     37,
};

// ─── Query descriptors ───────────────────────────────────────────────────
// Une requête Scryfall enrichie : id unique, slots qu'elle alimente, poids
export interface QueryDescriptor {
  id: string;
  slots: Slot[];
  query: (ci: string) => string;
  maxPages: number;
  weight: number;       // contribue au signal queryFrequency du scoring
  synergyTag?: string;  // si défini, les cartes remontées par cette query héritent du tag
}

// Sous-types trop génériques pour être de bons indicateurs tribaux
export const GENERIC_SUBTYPES = new Set([
  'human', 'wizard', 'shaman', 'warrior', 'cleric',
  'rogue', 'knight', 'soldier', 'druid', 'monk',
]);

// ─── Requêtes statiques par slot (otag-first + fallback oracle_text) ─────
export const SLOT_QUERIES: Record<Slot, QueryDescriptor[]> = {
  'ramp': [
    { id: 'ramp.otag',       slots: ['ramp'],             query: ci => `otag:ramp ${ci} format:commander`,                                          maxPages: 2, weight: 1.0 },
    { id: 'ramp.manaRock',   slots: ['ramp'],             query: ci => `otag:mana-rock ${ci} format:commander`,                                     maxPages: 2, weight: 0.9 },
    { id: 'ramp.fallback',   slots: ['ramp'],             query: ci => `o:"add {" type:artifact ${ci} format:commander`,                            maxPages: 1, weight: 0.4 },
    { id: 'ramp.searchLand', slots: ['ramp'],             query: ci => `o:"search your library" o:"land" (type:sorcery OR type:creature) ${ci} format:commander`, maxPages: 1, weight: 0.5 },
  ],
  'mana-fix': [
    { id: 'fix.fixing',      slots: ['mana-fix'],         query: ci => `otag:fixing ${ci} format:commander`,                                        maxPages: 1, weight: 1.0 },
    { id: 'fix.rainbow',     slots: ['mana-fix'],         query: ci => `otag:rainbow-land ${ci} format:commander`,                                  maxPages: 1, weight: 1.0 },
    { id: 'fix.anyColor',    slots: ['mana-fix'],         query: ci => `type:land o:"any color" ${ci} format:commander`,                            maxPages: 1, weight: 0.7 },
  ],
  'draw': [
    { id: 'draw.otag',       slots: ['draw'],             query: ci => `(otag:card-draw OR otag:card-advantage) ${ci} format:commander`,            maxPages: 2, weight: 1.0 },
    { id: 'draw.fallback',   slots: ['draw'],             query: ci => `o:"draw" o:"card" ${ci} format:commander`,                                  maxPages: 1, weight: 0.5 },
  ],
  'tutor': [
    { id: 'tutor.otag',      slots: ['tutor'],            query: ci => `otag:tutor ${ci} format:commander`,                                         maxPages: 2, weight: 1.0 },
  ],
  'spot-removal': [
    { id: 'rem.otag',        slots: ['spot-removal'],     query: ci => `otag:removal -otag:board-wipe -otag:boardwipe ${ci} format:commander`,      maxPages: 2, weight: 1.0 },
    { id: 'rem.fallback',    slots: ['spot-removal'],     query: ci => `(o:"destroy target" OR o:"exile target") (type:instant OR type:sorcery OR type:creature) ${ci} format:commander`, maxPages: 1, weight: 0.5 },
  ],
  'counterspell': [
    { id: 'counter.otag',    slots: ['counterspell'],     query: ci => `otag:counterspell ${ci} format:commander`,                                  maxPages: 1, weight: 1.0 },
  ],
  'board-wipe': [
    { id: 'wipe.otag1',      slots: ['board-wipe'],       query: ci => `otag:board-wipe ${ci} format:commander`,                                    maxPages: 1, weight: 1.0 },
    { id: 'wipe.otag2',      slots: ['board-wipe'],       query: ci => `otag:boardwipe ${ci} format:commander`,                                     maxPages: 1, weight: 1.0 },
    { id: 'wipe.fallback',   slots: ['board-wipe'],       query: ci => `(o:"destroy all" OR o:"exile all") type:sorcery ${ci} format:commander`,    maxPages: 1, weight: 0.5 },
  ],
  'protection': [
    { id: 'prot.creature',   slots: ['protection'],       query: ci => `otag:protects-creature ${ci} format:commander`,                             maxPages: 1, weight: 1.0 },
    { id: 'prot.permanent',  slots: ['protection'],       query: ci => `otag:protects-permanent ${ci} format:commander`,                            maxPages: 1, weight: 1.0 },
    { id: 'prot.gives',      slots: ['protection'],       query: ci => `(otag:gives-hexproof OR otag:gives-indestructible OR otag:gives-protection) ${ci} format:commander`, maxPages: 1, weight: 1.0 },
  ],
  'finisher': [
    { id: 'fin.wincon',      slots: ['finisher'],         query: ci => `(otag:win-condition OR otag:alternate-win-condition) ${ci} format:commander`, maxPages: 1, weight: 1.0 },
    { id: 'fin.fatBeater',   slots: ['finisher'],         query: ci => `type:creature pow>=5 (o:"flying" OR o:"trample" OR o:"can't be blocked") ${ci} format:commander`, maxPages: 1, weight: 0.6 },
  ],
  'synergy': [
    // Rempli dynamiquement par buildSynergyDescriptors() ; fallback générique :
    { id: 'syn.generic',     slots: ['synergy'],          query: ci => `type:creature ${ci} format:commander`,                                      maxPages: 1, weight: 0.3 },
  ],
};

// Descriptor pour les terrains non basiques (utilité)
export const NONBASIC_LAND_DESCRIPTORS: QueryDescriptor[] = [
  { id: 'land.util',     slots: [],                       query: ci => `type:land -type:basic ${ci} format:commander`,                              maxPages: 2, weight: 0.6 },
];

// ─── Synergie : descriptors générés depuis les tags du commander ─────────
export function buildSynergyDescriptors(
  commander: ScryfallCard,
  oracleTags: string[]
): QueryDescriptor[] {
  const out: QueryDescriptor[] = [];

  // Créatures synergiques (priorité haute)
  for (const tag of oracleTags.slice(0, 6)) {
    out.push({
      id: `syn.creature.${tag}`,
      slots: ['synergy'],
      query: ci => `otag:${tag} type:creature ${ci} format:commander`,
      maxPages: 2,
      weight: 1.0,
      synergyTag: tag,
    });
  }

  // Non-créatures synergiques (Grave Pact, Ashnod's Altar...)
  for (const tag of oracleTags.slice(0, 4)) {
    out.push({
      id: `syn.noncreature.${tag}`,
      slots: ['synergy'],
      query: ci => `otag:${tag} -type:creature ${ci} format:commander`,
      maxPages: 1,
      weight: 0.9,
      synergyTag: tag,
    });
  }

  // Tribal : sous-types non génériques du type_line
  const subtypePart = commander.type_line?.split('—')[1];
  if (subtypePart) {
    const subtypes = subtypePart.trim().split(/\s+/)
      .filter(s => s.length > 2 && !GENERIC_SUBTYPES.has(s.toLowerCase()));
    for (const subtype of subtypes.slice(0, 2)) {
      out.push({
        id: `syn.tribal.${subtype.toLowerCase()}`,
        slots: ['synergy'],
        query: ci => `type:${subtype.toLowerCase()} ${ci} format:commander`,
        maxPages: 1,
        weight: 0.8,
      });
    }
  }

  return out;
}
