import { ScryfallCard, searchCards, getEurPrice } from './scryfall';
import { Slot } from './types';
import { QueryDescriptor } from './slots';

export interface PoolEntry {
  card: ScryfallCard;
  price: number;
  queryHits: Map<string, number>;  // descriptorId → rang dans la requête (0 = top)
  slotHits: Set<Slot>;
  tagMatches: Set<string>;          // tags commander partagés
  score?: number;
  scoreBreakdown?: Record<string, number>;
}

// Lance toutes les requêtes et fusionne les résultats dans un pool dédupliqué par nom.
// Respecte ~10 req/s : batches de BATCH_SIZE en parallèle, pause entre batches.
const BATCH_SIZE = 3;
const BATCH_PAUSE_MS = 300;

export async function runPool(
  descriptors: QueryDescriptor[],
  ci: string,
  priceCap: number,
  log?: (msg: string, meta?: object) => void,
): Promise<PoolEntry[]> {
  const pool = new Map<string, PoolEntry>();
  const priceSuffix = ` eur<=${priceCap.toFixed(2)}`;

  for (let i = 0; i < descriptors.length; i += BATCH_SIZE) {
    const batch = descriptors.slice(i, i + BATCH_SIZE);
    const t0 = Date.now();
    const results = await Promise.allSettled(batch.map(async (d) => {
      const cards = await searchCards(d.query(ci) + priceSuffix, d.maxPages);
      return { d, cards };
    }));

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const { d, cards } = r.value;
      cards.forEach((card, rank) => {
        if (card.legalities?.commander !== 'legal') return;
        const price = getEurPrice(card);
        if (price <= 0) return;

        let entry = pool.get(card.name);
        if (!entry) {
          entry = { card, price, queryHits: new Map(), slotHits: new Set(), tagMatches: new Set() };
          pool.set(card.name, entry);
        }
        entry.queryHits.set(d.id, rank);
        for (const s of d.slots) entry.slotHits.add(s);
        if (d.synergyTag) entry.tagMatches.add(d.synergyTag);
      });
    }

    log?.(`Pool batch ${i / BATCH_SIZE + 1}/${Math.ceil(descriptors.length / BATCH_SIZE)} (${Date.now() - t0}ms)`);
    if (i + BATCH_SIZE < descriptors.length) {
      await new Promise(r => setTimeout(r, BATCH_PAUSE_MS));
    }
  }

  return [...pool.values()];
}

// ─── Dispatch glouton : assigne les cartes du pool aux slots cibles ─────
// Ordre : slots rares d'abord (counterspell, finisher, tutor, ...) pour ne pas
// se faire voler leurs candidats par synergy/spot-removal qui ont des pools énormes.
export const SLOT_DISPATCH_ORDER: Slot[] = [
  'counterspell',
  'finisher',
  'tutor',
  'protection',
  'mana-fix',
  'board-wipe',
  'ramp',
  'draw',
  'spot-removal',
  'synergy',
];

export interface DispatchContext {
  targets: Record<Slot, number>;
  budget: number;                   // budget restant initial
  hardCap: number;                   // prix max absolu par carte
  avgTargetPrice: number;            // prix moyen ciblé par carte
  budgetWeights: Record<Slot, number>;
  usedNames: Set<string>;            // mutable, déjà initialisé avec le commander
  onAssign?: (entry: PoolEntry, slot: Slot) => void;
}

export interface AssignedCard {
  entry: PoolEntry;
  slot: Slot;
  price: number;
}

export function dispatchPool(pool: PoolEntry[], ctx: DispatchContext): AssignedCard[] {
  const assigned: AssignedCard[] = [];

  // Pré-trier le pool par slot, par score décroissant
  const bySlot = new Map<Slot, PoolEntry[]>();
  for (const slot of SLOT_DISPATCH_ORDER) bySlot.set(slot, []);
  for (const e of pool) {
    for (const s of e.slotHits) {
      bySlot.get(s)?.push(e);
    }
  }
  for (const arr of bySlot.values()) {
    arr.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  let remainingBudget = ctx.budget;
  const remaining: Record<Slot, number> = { ...ctx.targets };

  for (const slot of SLOT_DISPATCH_ORDER) {
    const target = remaining[slot] ?? 0;
    if (target <= 0) continue;
    const candidates = bySlot.get(slot) ?? [];
    const slotWeight = ctx.budgetWeights[slot] ?? 1.0;
    let filled = 0;

    for (const entry of candidates) {
      if (filled >= target) break;
      if (ctx.usedNames.has(entry.card.name)) continue;

      // Plafond dynamique par carte : moyenne pondérée par slot, bornée par hardCap
      const remainingCards = Object.values(remaining).reduce((s, v) => s + v, 0);
      const dynamicMax = remainingCards > 0
        ? (remainingBudget / remainingCards) * slotWeight * 1.5
        : ctx.hardCap;
      const maxForCard = Math.min(ctx.hardCap, Math.max(dynamicMax, ctx.avgTargetPrice * slotWeight));
      if (entry.price > maxForCard) continue;

      ctx.usedNames.add(entry.card.name);
      remainingBudget -= entry.price;
      remaining[slot] = target - ++filled;
      assigned.push({ entry, slot, price: entry.price });
      ctx.onAssign?.(entry, slot);
    }
  }

  return assigned;
}
