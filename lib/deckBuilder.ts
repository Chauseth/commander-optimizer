import { ScryfallCard, searchCards, colorIdentityQuery, getEurPrice, getTaggerOracleTags } from './scryfall';
import { DeckCard, GeneratedDeck, SlotCounts, ProgressEvent, getCardTypeRole } from './types';
import { detectRoles, scoreCard } from './scoring';
import { DECK_SLOTS, BASIC_LANDS, BUDGET_WEIGHTS, buildSynergyQueries } from './slots';
import { computeSlotCounts, getMinBasicLands, adjustLandsForActualCurve } from './formula';

export type { DeckCard, GeneratedDeck, SlotCounts, ProgressEvent };
export { DEFAULT_SLOT_COUNTS } from './slots';

// ─── Logger ────────────────────────────────────────────────────────────────
function ts() {
  return new Date().toISOString().slice(11, 23);
}

const log = {
  info:  (msg: string, meta?: object) => console.log( `[${ts()}] INFO  ${msg}`, meta ? JSON.stringify(meta) : ''),
  warn:  (msg: string, meta?: object) => console.warn(`[${ts()}] WARN  ${msg}`, meta ? JSON.stringify(meta) : ''),
  error: (msg: string, meta?: object) => console.error(`[${ts()}] ERROR ${msg}`, meta ? JSON.stringify(meta) : ''),
  slot:  (role: string, found: number, target: number, ms: number) => {
    const ok = found >= target;
    const fn = ok ? console.log : console.warn;
    fn(`[${ts()}] SLOT  ${role.padEnd(16)} ${found}/${target} cartes  (${ms}ms)${ok ? '' : ' ⚠ incomplet'}`);
  },
};

// ─── generateDeck ──────────────────────────────────────────────────────────
export async function generateDeck(
  commander: ScryfallCard,
  budgetEur: number,
  onProgress?: (event: ProgressEvent) => void,
  slotCountsOverride?: Partial<SlotCounts>
): Promise<GeneratedDeck> {
  const globalStart = Date.now();
  log.info(`Génération démarrée`, {
    commander: commander.name,
    colors: commander.color_identity,
    budget: `${budgetEur}€`,
    overrides: slotCountsOverride ?? null,
  });

  const ci = colorIdentityQuery(commander.color_identity);

  const usedNames = new Set<string>([commander.name]);

  onProgress?.({ step: 'tagger' });
  const t0 = Date.now();
  const oracleTags = await getTaggerOracleTags(commander);
  log.info(`Tagger : ${oracleTags.length} tags (${Date.now() - t0}ms)`, { tags: oracleTags });

  const { counts: dynamicCounts, archetype, estimatedAvgCmc } = computeSlotCounts(commander, oracleTags);
  const slotCounts: SlotCounts = { ...dynamicCounts, ...slotCountsOverride };
  log.info(`Archétype détecté : ${archetype}`, {
    estimatedAvgCmc: estimatedAvgCmc.toFixed(2),
    distribution: slotCounts,
  });

  const minBasicLands = getMinBasicLands(commander.color_identity?.length ?? 0);

  const { totalLands, ...deckSlotCounts } = slotCounts;
  const basicLandReserve = totalLands * 0.10;
  const totalNonBasicTarget = Object.values(deckSlotCounts).reduce((s, v) => s + v, 0) + totalLands;
  let remainingBudget = budgetEur - basicLandReserve;
  let remainingCards = totalNonBasicTarget;

  const avgTargetPrice = remainingBudget / remainingCards;
  const hardCap = Math.max(Math.min(budgetEur * 0.15, avgTargetPrice * 5), 2);
  const scryfallPriceCap = Math.max(avgTargetPrice * 3, 10);

  log.info(`Budget : ${remainingBudget.toFixed(2)}€ | hardCap : ${hardCap.toFixed(2)}€ | scryfallCap : ${scryfallPriceCap.toFixed(2)}€ | avgTarget : ${avgTargetPrice.toFixed(2)}€`);

  const synergyFallbackQueries = buildSynergyQueries(commander, oracleTags);

  const allDeckCards: DeckCard[] = [];
  let totalPrice = 0;

  // ── File d'animation pour l'UI ────────────────────────────────────────────
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

  // ── Remplir chaque slot ────────────────────────────────────────────────
  for (const slot of DECK_SLOTS) {
    await waitForAnimations();
    onProgress?.({ step: slot.role });
    const slotStart = Date.now();
    const target = slot.role === 'Terrains non basiques'
      ? totalLands - minBasicLands
      : (deckSlotCounts[slot.role as keyof typeof deckSlotCounts] ?? slot.count);
    let needed = target;

    const slotWeight = BUDGET_WEIGHTS[slot.role] ?? 1.0;
    const queriesToRun = slot.role === 'Synergie'
      ? [...synergyFallbackQueries, ...slot.queries]
      : slot.queries;

    for (const buildQuery of queriesToRun) {
      if (needed <= 0) break;
      const q = `${buildQuery(ci)} eur<=${scryfallPriceCap.toFixed(2)}`;
      let candidates: ScryfallCard[] = [];
      try {
        const t2 = Date.now();
        candidates = await searchCards(q);
        log.info(`  [${slot.role}] ${candidates.length} résultats (${Date.now() - t2}ms)`, { q });
      } catch (err) {
        log.error(`  [${slot.role}] Requête échouée`, { q, err: String(err) });
      }

      const filtered = candidates
        .filter(c => c.legalities?.commander === 'legal' && !usedNames.has(c.name) && getEurPrice(c) > 0)
        .sort((a, b) => {
          const rolesA = detectRoles(a);
          const rolesB = detectRoles(b);
          return scoreCard(b, oracleTags, slot.role, rolesB)
               - scoreCard(a, oracleTags, slot.role, rolesA);
        });

      for (const card of filtered) {
        if (needed <= 0) break;
        const price = getEurPrice(card);
        const dynamicMax = remainingCards > 0 ? (remainingBudget / remainingCards) * slotWeight * 1.5 : hardCap;
        const maxForCard = Math.min(hardCap, Math.max(dynamicMax, avgTargetPrice * slotWeight));
        if (price > maxForCard) continue;
        usedNames.add(card.name);
        totalPrice += price;
        remainingBudget -= price;
        remainingCards--;
        const isSynergySlot = slot.role === 'Synergie';
        const role = isSynergySlot ? getCardTypeRole(card.type_line ?? '') : slot.role;
        allDeckCards.push({ card, role, eurPrice: price, count: 1, ...(isSynergySlot && { isSynergy: true }) });
        notifyCard(card);
        needed--;
      }
    }

    log.slot(slot.role, target - needed, target, Date.now() - slotStart);
  }

  // ── Passe d'upgrade ────────────────────────────────────────────────────
  const upgradeThreshold = budgetEur * 0.10;
  if (remainingBudget > upgradeThreshold) {
    await waitForAnimations();
    onProgress?.({ step: 'Upgrade' });
    const upgradeStart = Date.now();
    log.info(`Upgrade démarré`, { budget_restant: `${remainingBudget.toFixed(2)}€` });

    const upgradeCandidates = allDeckCards
      .filter(dc => dc.role !== 'Terrains basiques' && dc.role !== 'Terrains non basiques')
      .sort((a, b) => a.eurPrice - b.eurPrice);

    let upgradeCount = 0;
    const maxUpgrades = Math.min(10, Math.floor(remainingBudget / 2));

    for (const candidate of upgradeCandidates) {
      if (upgradeCount >= maxUpgrades || remainingBudget < 1) break;

      const upgradebudget = candidate.eurPrice + remainingBudget * 0.3;
      if (upgradebudget <= candidate.eurPrice + 0.5) continue;

      const synergyFallback = DECK_SLOTS.find(s => s.role === 'Synergie')!.queries[0];
      const roleQuery = candidate.isSynergy
        ? synergyFallback
        : DECK_SLOTS.find(s => s.role === candidate.role)?.queries[0];
      if (!roleQuery) continue;

      const q = `${roleQuery(ci)} eur>${candidate.eurPrice.toFixed(2)} eur<=${upgradebudget.toFixed(2)}`;
      try {
        const upgrades = await searchCards(q);
        const validUpgrades = upgrades
          .filter(c =>
            c.legalities?.commander === 'legal' &&
            !usedNames.has(c.name) &&
            getEurPrice(c) > candidate.eurPrice &&
            (c.edhrec_rank ?? 99999) < (candidate.card.edhrec_rank ?? 99999)
          )
          .sort((a, b) => (a.edhrec_rank ?? 99999) - (b.edhrec_rank ?? 99999));

        if (validUpgrades.length > 0) {
          const upgrade = validUpgrades[0];
          const newPrice = getEurPrice(upgrade);
          const priceDiff = newPrice - candidate.eurPrice;
          const oldCard = candidate.card;
          usedNames.delete(candidate.card.name);
          usedNames.add(upgrade.name);
          candidate.card = upgrade;
          candidate.eurPrice = newPrice;
          totalPrice += priceDiff;
          remainingBudget -= priceDiff;
          upgradeCount++;
          notifyUpgrade(oldCard, upgrade);
          log.info(`  Upgrade: ${oldCard.name} → ${upgrade.name} (+${priceDiff.toFixed(2)}€)`);
        }
      } catch { /* ignore */ }
    }

    log.info(`Upgrade terminé`, { upgrades: upgradeCount, budget_restant: `${remainingBudget.toFixed(2)}€`, durée: `${Date.now() - upgradeStart}ms` });
  }

  // ── Ajustement mana base selon la courbe réelle ────────────────────────
  const nonLandCards = allDeckCards.filter(dc => !dc.card.type_line?.toLowerCase().includes('land'));
  const actualAvgCmc = nonLandCards.length > 0
    ? nonLandCards.reduce((sum, dc) => sum + (dc.card.cmc ?? 0), 0) / nonLandCards.length
    : estimatedAvgCmc;
  const adjustedCounts = adjustLandsForActualCurve(slotCounts, estimatedAvgCmc, actualAvgCmc);
  const adjustedTotalLands = adjustedCounts.totalLands;
  if (adjustedTotalLands !== totalLands) {
    log.info(`Ajustement lands post-construction`, {
      estimatedAvgCmc: estimatedAvgCmc.toFixed(2),
      actualAvgCmc: actualAvgCmc.toFixed(2),
      totalLands: `${totalLands} → ${adjustedTotalLands}`,
    });
  }

  // ── Terrains basiques ──────────────────────────────────────────────────
  const nonBasicLandsFound = allDeckCards.filter(dc => dc.role === 'Terrains non basiques').length;
  const landsNeeded = Math.max(0, adjustedTotalLands - nonBasicLandsFound);
  const colors = commander.color_identity.filter(c => BASIC_LANDS[c]);
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
      role: 'Terrains basiques',
      eurPrice: unitPrice * count,
      count,
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
