import { ScryfallCard, colorIdentityQuery, getTaggerOracleTags } from './scryfall';
import { DeckCard, GeneratedDeck, Slot, SlotCounts, ProgressEvent, getCardTypeRole } from './types';
import { scoreCard } from './scoring';
import {
  SLOT_QUERIES, NONBASIC_LAND_DESCRIPTORS, BUDGET_WEIGHTS, SLOT_LABEL_FR,
  NONBASIC_LAND_LABEL, BASIC_LAND_LABEL, BASIC_LANDS,
  buildSynergyDescriptors, QueryDescriptor,
} from './slots';
import { runPool, dispatchPool, PoolEntry, AssignedCard } from './pool';
import { computeSlotCounts, getMinBasicLands, adjustLandsForActualCurve, FUNCTIONAL_SLOTS } from './formula';

export type { DeckCard, GeneratedDeck, SlotCounts, ProgressEvent };
export { DEFAULT_SLOT_COUNTS } from './slots';

// ─── Logger ────────────────────────────────────────────────────────────────
function ts() { return new Date().toISOString().slice(11, 23); }
const log = {
  info:  (msg: string, meta?: object) => console.log( `[${ts()}] INFO  ${msg}`, meta ? JSON.stringify(meta) : ''),
  warn:  (msg: string, meta?: object) => console.warn(`[${ts()}] WARN  ${msg}`, meta ? JSON.stringify(meta) : ''),
  error: (msg: string, meta?: object) => console.error(`[${ts()}] ERROR ${msg}`, meta ? JSON.stringify(meta) : ''),
};

const SCORE_LABELS: Record<string, string> = {
  popularity: 'Popularite EDHREC',
  synergy: 'Synergie tags',
  multiRole: 'Multi-role',
  archetypeFit: 'Fit archetype',
  queryFrequency: 'Frequence requetes',
  priceEfficiency: 'Efficacite prix',
};

function buildExplanation(entry: PoolEntry, selectedSlot: string, note?: string): DeckCard['explanation'] {
  const topFactors = Object.entries(entry.scoreBreakdown ?? {})
    .map(([key, value]) => ({ label: SCORE_LABELS[key] ?? key, value: Math.round(value) }))
    .filter(factor => factor.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);

  return {
    selectedSlot,
    score: Math.round(entry.score ?? 0),
    topFactors,
    matchedTags: [...entry.tagMatches].slice(0, 5),
    matchedQueries: [...entry.queryHits.keys()].slice(0, 5),
    ...(note && { note }),
  };
}

export async function generateDeck(
  commander: ScryfallCard,
  budgetEur: number,
  onProgress?: (event: ProgressEvent) => void,
  slotCountsOverride?: Partial<SlotCounts>,
): Promise<GeneratedDeck> {
  const globalStart = Date.now();
  log.info(`Génération démarrée`, { commander: commander.name, colors: commander.color_identity, budget: `${budgetEur}€`, overrides: slotCountsOverride ?? null });

  const ci = colorIdentityQuery(commander.color_identity);
  const usedNames = new Set<string>([commander.name]);

  // ── Phase 0 : Tagger + computeSlotCounts ──────────────────────────────
  onProgress?.({ step: 'tagger' });
  const tTagger = Date.now();
  const oracleTags = await getTaggerOracleTags(commander);
  log.info(`Tagger : ${oracleTags.length} tags (${Date.now() - tTagger}ms)`, { tags: oracleTags });

  const { counts: dynamicCounts, archetype, estimatedAvgCmc } = computeSlotCounts(commander, oracleTags);
  const slotCounts: SlotCounts = { ...dynamicCounts, ...slotCountsOverride };
  log.info(`Archétype : ${archetype}`, { estimatedAvgCmc: estimatedAvgCmc.toFixed(2), distribution: slotCounts });

  const minBasicLands = getMinBasicLands(commander.color_identity?.length ?? 0);
  const totalLands = slotCounts.totalLands;
  const nonBasicLandTarget = Math.max(0, totalLands - minBasicLands);

  // ── Budget ────────────────────────────────────────────────────────────
  const totalNonLands = FUNCTIONAL_SLOTS.reduce((s, k) => s + slotCounts[k], 0);
  const totalCardsTarget = totalNonLands + nonBasicLandTarget;
  const basicReserve = totalLands * 0.10; // ~3.7€
  const remainingBudget0 = Math.max(0, budgetEur - basicReserve);
  const avgTargetPrice = totalCardsTarget > 0 ? remainingBudget0 / totalCardsTarget : 0;
  const hardCap = Math.max(Math.min(budgetEur * 0.15, avgTargetPrice * 5), 2);
  const scryfallPriceCap = Math.max(avgTargetPrice * 3, 10);
  log.info(`Budget : ${remainingBudget0.toFixed(2)}€ | hardCap : ${hardCap.toFixed(2)}€ | scryfallCap : ${scryfallPriceCap.toFixed(2)}€ | avgTarget : ${avgTargetPrice.toFixed(2)}€`);

  // ── File d'animation pour l'UI ─────────────────────────────────────────
  type QueueItem = string | { oldImg: string; newImg: string };
  const cardQueue: QueueItem[] = [];
  let isProcessingQueue = false;
  const processCardQueue = async () => {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    while (cardQueue.length > 0) {
      if (cardQueue.length > 5) {
        const batch = cardQueue.splice(0, 3);
        for (const item of batch) {
          const img = typeof item === 'string' ? item : item.newImg;
          const oldImg = typeof item === 'object' ? item.oldImg : undefined;
          onProgress?.({ step: 'card', cardImage: img, ...(oldImg && { upgradeOldImage: oldImg }) });
        }
        await new Promise(r => setTimeout(r, 300));
      } else {
        const item = cardQueue.shift()!;
        const isUpgrade = typeof item === 'object';
        const img = isUpgrade ? item.newImg : item;
        const oldImg = isUpgrade ? item.oldImg : undefined;
        onProgress?.({ step: 'card', cardImage: img, ...(oldImg && { upgradeOldImage: oldImg }) });
        await new Promise(r => setTimeout(r, isUpgrade ? 900 : 200));
      }
    }
    isProcessingQueue = false;
  };
  const notifyCard = (card: ScryfallCard) => {
    const img = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small;
    if (img) { cardQueue.push(img); processCardQueue(); }
  };
  const notifyUpgrade = (oldCard: ScryfallCard, newCard: ScryfallCard) => {
    const oldImg = oldCard.image_uris?.small || oldCard.card_faces?.[0]?.image_uris?.small;
    const newImg = newCard.image_uris?.small || newCard.card_faces?.[0]?.image_uris?.small;
    if (newImg) { cardQueue.push(oldImg ? { oldImg, newImg } : newImg); processCardQueue(); }
  };
  const waitForAnimations = async () => {
    while (cardQueue.length > 0 || isProcessingQueue) {
      await new Promise(r => setTimeout(r, 50));
    }
    await new Promise(r => setTimeout(r, 700));
  };

  // ── Phase A : construire les descriptors ──────────────────────────────
  const descriptors: QueryDescriptor[] = [];
  for (const slot of FUNCTIONAL_SLOTS) {
    if (slotCounts[slot] <= 0 && slot !== 'synergy') continue;
    descriptors.push(...SLOT_QUERIES[slot]);
  }
  // Synergie : descriptors dynamiques basés sur les tags du commander
  descriptors.push(...buildSynergyDescriptors(commander, oracleTags));
  if (nonBasicLandTarget > 0) descriptors.push(...NONBASIC_LAND_DESCRIPTORS);

  // Map id → weight pour le scoring
  const descriptorWeights = new Map<string, number>();
  for (const d of descriptors) descriptorWeights.set(d.id, d.weight);

  // ── Phase B : pool commun en parallèle batché ─────────────────────────
  onProgress?.({ step: 'pool' });
  const tPool = Date.now();
  const pool = await runPool(descriptors, ci, scryfallPriceCap, (msg) => log.info(`  ${msg}`));
  log.info(`Pool construit : ${pool.length} cartes uniques (${Date.now() - tPool}ms)`);

  // Nonbasic-land descriptors n'ont pas de slot — on assigne manuellement
  // (ils sont consommés par Phase F, pas par dispatchPool sur slots fonctionnels)
  const landPool: PoolEntry[] = [];
  for (const entry of pool) {
    if (entry.card.type_line?.toLowerCase().includes('land')
        && !entry.card.type_line?.toLowerCase().includes('basic')) {
      landPool.push(entry);
    }
  }

  // ── Phase C : scoring vectoriel ───────────────────────────────────────
  onProgress?.({ step: 'scoring' });
  for (const entry of pool) {
    const { total, breakdown } = scoreCard(entry, {
      archetype, commander,
      slotAvgBudget: avgTargetPrice,
      descriptorWeights,
    });
    entry.score = total;
    entry.scoreBreakdown = breakdown;
  }

  // ── Phase D : dispatch glouton ────────────────────────────────────────
  onProgress?.({ step: 'dispatch' });
  const allDeckCards: DeckCard[] = [];
  let totalPrice = 0;

  const targets: Record<Slot, number> = {} as Record<Slot, number>;
  for (const slot of FUNCTIONAL_SLOTS) targets[slot] = slotCounts[slot];

  const assigned = dispatchPool(pool, {
    targets, budget: remainingBudget0, hardCap, avgTargetPrice,
    budgetWeights: BUDGET_WEIGHTS as unknown as Record<Slot, number>,
    usedNames,
    onAssign: (entry, slot) => {
      const isSynergy = slot === 'synergy';
      const role = isSynergy ? getCardTypeRole(entry.card.type_line ?? '') : SLOT_LABEL_FR[slot];
      allDeckCards.push({
        card: entry.card,
        role,
        eurPrice: entry.price,
        count: 1,
        explanation: buildExplanation(entry, SLOT_LABEL_FR[slot]),
        ...(isSynergy && { isSynergy: true }),
      });
      totalPrice += entry.price;
      notifyCard(entry.card);
    },
  });

  // Log par slot
  const filledBySlot = new Map<Slot, number>();
  for (const a of assigned) filledBySlot.set(a.slot, (filledBySlot.get(a.slot) ?? 0) + 1);
  for (const slot of FUNCTIONAL_SLOTS) {
    const filled = filledBySlot.get(slot) ?? 0;
    const target = targets[slot];
    if (target > 0) log.info(`  SLOT ${SLOT_LABEL_FR[slot].padEnd(14)} ${filled}/${target}${filled < target ? ' ⚠' : ''}`);
  }

  let remainingBudget = remainingBudget0 - totalPrice;

  // ── Phase E : Upgrade pass (pioche dans le pool restant) ──────────────
  if (remainingBudget > budgetEur * 0.10) {
    await waitForAnimations();
    onProgress?.({ step: 'Upgrade' });
    const tUpg = Date.now();
    log.info(`Upgrade démarré`, { budget_restant: `${remainingBudget.toFixed(2)}€` });

    const assignedByName = new Map<string, AssignedCard>();
    for (const a of assigned) assignedByName.set(a.entry.card.name, a);

    // Index pool par slot, pré-trié par score (déjà fait dans dispatchPool, mais re-créé ici)
    const poolBySlot = new Map<Slot, PoolEntry[]>();
    for (const slot of FUNCTIONAL_SLOTS) poolBySlot.set(slot, []);
    for (const e of pool) {
      for (const s of e.slotHits) poolBySlot.get(s)?.push(e);
    }
    for (const arr of poolBySlot.values()) arr.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const upgradeCandidates = [...assigned].sort((a, b) => a.price - b.price);
    let upgradeCount = 0;
    // Les garde-fous internes (remainingBudget < 1, delta de prix minimum) arrêtent
    // naturellement les upgrades — pas besoin de plafonner via remainingBudget / 2.
    const maxUpgrades = Math.min(15, assigned.length);

    for (const cand of upgradeCandidates) {
      if (upgradeCount >= maxUpgrades || remainingBudget < 1) break;
      const upgradeBudget = cand.price + remainingBudget * 0.3;
      if (upgradeBudget <= cand.price + 0.5) continue;

      const candidatesPool = poolBySlot.get(cand.slot) ?? [];
      const better = candidatesPool.find(e =>
        e.card.name !== cand.entry.card.name &&
        !usedNames.has(e.card.name) &&
        e.price > cand.price &&
        e.price <= upgradeBudget &&
        (e.score ?? 0) > (cand.entry.score ?? 0)
      );
      if (!better) continue;

      const oldCard = cand.entry.card;
      const priceDiff = better.price - cand.price;
      usedNames.delete(oldCard.name);
      usedNames.add(better.card.name);

      // Mettre à jour le DeckCard correspondant
      const dc = allDeckCards.find(d => d.card.name === oldCard.name);
      if (dc) {
        dc.card = better.card;
        dc.eurPrice = better.price;
        dc.explanation = buildExplanation(better, SLOT_LABEL_FR[cand.slot], `Upgrade depuis ${oldCard.name}`);
        if (cand.slot === 'synergy') dc.role = getCardTypeRole(better.card.type_line ?? '');
      }
      cand.entry = better;
      cand.price = better.price;
      totalPrice += priceDiff;
      remainingBudget -= priceDiff;
      upgradeCount++;
      notifyUpgrade(oldCard, better.card);
      log.info(`  Upgrade: ${oldCard.name} → ${better.card.name} (+${priceDiff.toFixed(2)}€)`);
    }
    log.info(`Upgrade terminé`, { upgrades: upgradeCount, budget_restant: `${remainingBudget.toFixed(2)}€`, durée: `${Date.now() - tUpg}ms` });
  }

  // ── Phase F : terrains non basiques (utilité) + ajustement courbe ─────
  onProgress?.({ step: NONBASIC_LAND_LABEL });
  await waitForAnimations();

  // Les lands ont déjà un score vectoriel complet (Phase C) : popularité, archetypeFit,
  // priceEfficiency, queryFrequency. On trie par score décroissant pour que les terres
  // thématiques (ex: Phyrexian Tower en aristocrats, Nykthos en mono) remontent naturellement.
  landPool.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  let nonBasicLandsAdded = 0;
  for (const entry of landPool) {
    if (nonBasicLandsAdded >= nonBasicLandTarget) break;
    if (usedNames.has(entry.card.name)) continue;
    const slotWeight = BUDGET_WEIGHTS['nonbasic-land'];
    const remainingCardsLocal = nonBasicLandTarget - nonBasicLandsAdded;
    const dynamicMax = remainingCardsLocal > 0
      ? Math.max(remainingBudget / Math.max(1, remainingCardsLocal), avgTargetPrice) * slotWeight
      : hardCap;
    const maxForCard = Math.min(hardCap, Math.max(dynamicMax, avgTargetPrice * slotWeight));
    if (entry.price > maxForCard) continue;
    usedNames.add(entry.card.name);
    totalPrice += entry.price;
    remainingBudget -= entry.price;
    nonBasicLandsAdded++;
    allDeckCards.push({
      card: entry.card,
      role: NONBASIC_LAND_LABEL,
      eurPrice: entry.price,
      count: 1,
      explanation: buildExplanation(entry, NONBASIC_LAND_LABEL),
    });
    notifyCard(entry.card);
  }
  log.info(`SLOT ${NONBASIC_LAND_LABEL.padEnd(14)} ${nonBasicLandsAdded}/${nonBasicLandTarget}`);

  // Ajustement courbe réelle
  const nonLandCards = allDeckCards.filter(dc => !dc.card.type_line?.toLowerCase().includes('land'));
  const actualAvgCmc = nonLandCards.length > 0
    ? nonLandCards.reduce((sum, dc) => sum + (dc.card.cmc ?? 0), 0) / nonLandCards.length
    : estimatedAvgCmc;
  const adjustedCounts = adjustLandsForActualCurve(slotCounts, estimatedAvgCmc, actualAvgCmc);
  const adjustedTotalLands = adjustedCounts.totalLands;
  if (adjustedTotalLands !== totalLands) {
    log.info(`Ajustement lands post-construction`, { estimatedAvgCmc: estimatedAvgCmc.toFixed(2), actualAvgCmc: actualAvgCmc.toFixed(2), totalLands: `${totalLands} → ${adjustedTotalLands}` });
  }

  // ── Phase F bis : terrains basiques ───────────────────────────────────
  const landsNeeded = Math.max(0, adjustedTotalLands - nonBasicLandsAdded);
  const colors = (commander.color_identity ?? []).filter(c => BASIC_LANDS[c]);
  const landColors = colors.length > 0 ? colors : ['W'];
  const basicLandMap: Record<string, { landName: string; count: number }> = {};
  const perColor = Math.floor(landsNeeded / landColors.length);
  const extra = landsNeeded % landColors.length;
  landColors.forEach((color, idx) => {
    const landName = BASIC_LANDS[color];
    const qty = perColor + (idx < extra ? 1 : 0);
    if (!basicLandMap[landName]) basicLandMap[landName] = { landName, count: 0 };
    basicLandMap[landName].count += qty;
  });

  const basicSummary: Record<string, number> = {};
  for (const { landName, count } of Object.values(basicLandMap)) {
    if (count <= 0) continue;
    const unitPrice = 0.10;
    allDeckCards.push({
      card: {
        id: `basic-${landName}`,
        name: landName,
        type_line: 'Basic Land',
        color_identity: [],
        cmc: 0,
        prices: { eur: String(unitPrice) },
        legalities: { commander: 'legal' },
        scryfall_uri: `https://scryfall.com/search?q=${encodeURIComponent(`!"${landName}"`)}`,
      } as ScryfallCard,
      role: BASIC_LAND_LABEL,
      eurPrice: unitPrice * count,
      count,
      explanation: {
        selectedSlot: BASIC_LAND_LABEL,
        score: 0,
        topFactors: [],
        matchedTags: [],
        matchedQueries: [],
        note: `Ajoute automatiquement pour atteindre ${adjustedTotalLands} terrains et respecter l'identite couleur.`,
      },
    });
    totalPrice += unitPrice * count;
    basicSummary[landName] = count;
  }
  log.info(`Terrains basiques`, basicSummary);

  // ── Résumé final ───────────────────────────────────────────────────────
  const byRole: Record<string, DeckCard[]> = {};
  for (const dc of allDeckCards) {
    if (!byRole[dc.role]) byRole[dc.role] = [];
    byRole[dc.role].push(dc);
  }
  const totalCards = allDeckCards.reduce((sum, dc) => sum + dc.count, 0);
  const totalMs = Date.now() - globalStart;
  log.info(`Génération terminée`, {
    commander: commander.name,
    total_cartes: totalCards,
    prix_total: `${(Math.round(totalPrice * 100) / 100).toFixed(2)}€`,
    budget_utilisé: `${Math.round((totalPrice / budgetEur) * 100)}%`,
    durée: `${totalMs}ms`,
  });
  if (totalCards < 99) log.warn(`Deck incomplet : ${totalCards}/99 cartes`);

  while (cardQueue.length > 0 || isProcessingQueue) {
    await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => setTimeout(r, 1800));

  return {
    commander,
    cards: allDeckCards,
    totalCards,
    totalPrice: Math.round(totalPrice * 100) / 100,
    budgetUsed: Math.round((totalPrice / budgetEur) * 100),
    byRole,
  };
}
