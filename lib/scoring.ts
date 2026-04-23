import { ScryfallCard } from './scryfall';
import { PoolEntry } from './pool';
import { Archetype } from './formula';

// ─── Scoring vectoriel borné ─────────────────────────────────────────────
// Chaque composante est plafonnée pour éviter qu'un signal n'écrase les autres.
// Le score total est une somme pondérée, configurable via SCORING_WEIGHTS.

export const SCORING_WEIGHTS = {
  popularity:      1.0,
  synergy:         1.0,
  multiRole:       1.0,
  archetypeFit:    1.0,
  queryFrequency:  1.0,
  priceEfficiency: 1.0,
};

export interface ScoreContext {
  archetype: Archetype;
  commander: ScryfallCard;
  slotAvgBudget: number;          // prix moyen ciblé par carte (pour priceEfficiency)
  descriptorWeights: Map<string, number>;
}

export interface Scoring {
  total: number;
  breakdown: Record<string, number>;
}

const K_FREQ_NORM = 2.0; // calibre le signal queryFrequency (somme des 1/(rank+1) pondérée)

export function scoreCard(entry: PoolEntry, ctx: ScoreContext): Scoring {
  // 1. Popularité EDHrec — plafonnée à 100
  const popularity = entry.card.edhrec_rank
    ? Math.max(0, 100 - entry.card.edhrec_rank / 1000)
    : 0;

  // 2. Synergie — capée à 3 tags pour éviter l'emballement (1 tag = 33pts)
  const synergy = Math.min(1, entry.tagMatches.size / 3) * 100;

  // 3. Multi-rôle — bonus pour cartes qui couvrent plusieurs slots
  const multiRoleBonus = Math.min(1, Math.max(0, entry.slotHits.size - 1) / 3) * 30;

  // 4. Archetype fit — heuristique par archétype
  const archetypeFit = computeArchetypeFit(entry, ctx.archetype);

  // 5. Fréquence dans les requêtes — Σ(weight / (rank + 1)), plus la carte est
  //    remontée tôt par plusieurs descriptors, plus le signal est fort
  let freqSum = 0;
  for (const [id, rank] of entry.queryHits) {
    const w = ctx.descriptorWeights.get(id) ?? 1;
    freqSum += w / (rank + 1);
  }
  const queryFrequency = Math.min(1, freqSum / K_FREQ_NORM) * 20;

  // 6. Efficacité prix — favorise les cartes pas chères quand le budget est serré
  const priceEfficiency = ctx.slotAvgBudget > 0
    ? Math.max(0, Math.min(1, 1 - entry.price / (ctx.slotAvgBudget * 3))) * 20
    : 0;

  const W = SCORING_WEIGHTS;
  const total =
      popularity      * W.popularity
    + synergy         * W.synergy
    + multiRoleBonus  * W.multiRole
    + archetypeFit    * W.archetypeFit
    + queryFrequency  * W.queryFrequency
    + priceEfficiency * W.priceEfficiency;

  return {
    total,
    breakdown: { popularity, synergy, multiRole: multiRoleBonus, archetypeFit, queryFrequency, priceEfficiency },
  };
}

// ─── Archetype fit : heuristique 0..30 selon l'archétype détecté ─────────
// Remplace ARCHETYPE_SLOT_QUERIES de l'ancien formula.ts.
export function computeArchetypeFit(
  entry: PoolEntry,
  archetype: Archetype,
): number {
  const card = entry.card;
  const text = card.oracle_text ?? '';
  const type = card.type_line ?? '';
  let fit = 0;

  switch (archetype) {
    case 'aristocrats':
      if (/\bsacrifice\b/i.test(text)) fit += 15;
      if (/\bdies\b/i.test(text) || /\bdeath\b/i.test(text)) fit += 10;
      break;
    case 'reanimator':
      if (/\bgraveyard\b/i.test(text)) fit += 12;
      if (/\breturn\b.*\bbattlefield\b/i.test(text)) fit += 10;
      if (/\bmill\b/i.test(text) || /\bdiscard\b/i.test(text)) fit += 8;
      break;
    case 'spellslinger':
      if (type.includes('Instant') || type.includes('Sorcery')) fit += 15;
      if (/\bcopy\b.*\b(instant|sorcery)\b/i.test(text)) fit += 10;
      if (/\bprowess\b/i.test(text) || /\bmagecraft\b/i.test(text)) fit += 5;
      break;
    case 'lands':
      if (/\blandfall\b/i.test(text)) fit += 15;
      if (/\bplay\b.*\badditional land/i.test(text)) fit += 12;
      if (/\bsearch your library\b.*\bland/i.test(text)) fit += 8;
      break;
    case 'control':
      if (/\bcounter target\b/i.test(text)) fit += 12;
      if (type.includes('Instant')) fit += 6;
      if (/\beach opponent\b/i.test(text)) fit += 4;
      break;
    case 'combo-tutor':
      if (/\bsearch your library\b/i.test(text)) fit += 15;
      if (/\bdraw\b.*\bcards?\b/i.test(text)) fit += 5;
      break;
    case 'tokens':
      if (/\bcreate\b.*\btoken\b/i.test(text)) fit += 15;
      if (/\bcreatures? you control\b/i.test(text)) fit += 8;
      break;
    case 'wheel':
      if (/\beach (player|opponent) draws\b/i.test(text)) fit += 15;
      if (/\bdiscard\b.*\bdraw\b/i.test(text)) fit += 10;
      break;
    case 'enchantress':
      if (type.includes('Enchantment')) fit += 12;
      if (/\bwhenever you cast an enchantment\b/i.test(text)) fit += 12;
      break;
    case 'aura-voltron':
      if (/\baura\b/i.test(text)) fit += 12;
      if (type.includes('Aura')) fit += 10;
      if (/\bhexproof\b/i.test(text) || /\bindestructible\b/i.test(text)) fit += 6;
      break;
    case 'equipment-voltron':
      if (type.includes('Equipment')) fit += 15;
      if (/\bequipped creature\b/i.test(text)) fit += 8;
      break;
    case 'blink':
      if (/\bexile\b.*\breturn\b.*\bbattlefield\b/i.test(text)) fit += 15;
      if (/\benters the battlefield\b/i.test(text)) fit += 8;
      break;
    case 'tribal':
      // boost via tagMatches du commander, déjà capté par synergy
      break;
    case 'aggro-cheap':
      if ((card.cmc ?? 99) <= 2) fit += 10;
      if (/\bhaste\b/i.test(text)) fit += 8;
      if (/\battacks\b/i.test(text)) fit += 5;
      break;
    case 'lifegain':
      if (/\bgain\b.*\blife\b/i.test(text)) fit += 12;
      if (/\bwhenever you gain life\b/i.test(text)) fit += 10;
      break;
    case '+1/+1-counters':
      if (/\+1\/\+1 counter/i.test(text)) fit += 15;
      if (/\bproliferate\b/i.test(text)) fit += 12;
      break;
    case 'stax':
      if (/\bcost\b.*\bmore to cast\b/i.test(text)) fit += 15;
      if (/\bdoesn't untap\b/i.test(text) || /\bcan't attack\b/i.test(text)) fit += 10;
      break;
    case 'default':
    default:
      break;
  }

  return Math.min(30, fit);
}
