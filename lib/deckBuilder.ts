import { ScryfallCard, searchCards, fetchCardsByNames, colorIdentityQuery, getEurPrice, getEdhrecRecommendations, getCardImage } from './scryfall';

// ─── Distribution cible ────────────────────────────────────────────────────
// 10 rampe | 10 pioche | 8 suppression | 3 balayage | 31 synergie
// 10 terres non-basic | 27 terres basiques = 99 cartes
const MAX_BASIC_LANDS = 27;

const DECK_SLOTS: Array<{
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
    ],
  },
  {
    role: 'Pioche',
    count: 10,
    queries: [
      (ci) => `o:"draw" o:"card" (type:instant OR type:sorcery) ${ci} format:commander`,
      (ci) => `o:"draw" o:"card" type:enchantment ${ci} format:commander`,
      (ci) => `o:"draw" o:"card" type:artifact ${ci} format:commander`,
    ],
  },
  {
    role: 'Suppression',
    count: 8,
    queries: [
      (ci) => `(o:"destroy target" OR o:"exile target") type:instant ${ci} format:commander`,
      (ci) => `(o:"destroy target" OR o:"exile target") type:sorcery ${ci} format:commander`,
    ],
  },
  {
    role: 'Balayage',
    count: 3,
    queries: [
      (ci) => `o:"destroy all" type:sorcery ${ci} format:commander`,
      (ci) => `o:"all creatures" o:"destroy" type:sorcery ${ci} format:commander`,
      (ci) => `o:"exile all" type:sorcery ${ci} format:commander`,
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

const BASIC_LANDS: Record<string, string> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
};

// ─── Pondération budgétaire par rôle ───────────────────────────────────────
// Les rôles critiques (rampe, pioche) méritent plus de budget par carte
const BUDGET_WEIGHTS: Record<string, number> = {
  'Rampe': 1.5,              // Cartes importantes, on peut investir plus
  'Pioche': 1.4,             // Draw engine crucial
  'Suppression': 1.2,        // Removal de qualité
  'Balayage': 1.0,           // Boardwipes souvent moins chers
  'Synergie': 1.3,           // Créatures synergiques importantes
  'Terrains non basiques': 0.8, // Beaucoup de bonnes terres pas chères
};

export interface DeckCard {
  card: ScryfallCard;
  role: string;
  eurPrice: number;
  count: number;
  isSynergy?: boolean;
}

function getCardTypeRole(typeLine: string): string {
  if (typeLine.includes('Creature'))    return 'Créature';
  if (typeLine.includes('Planeswalker')) return 'Planeswalker';
  if (typeLine.includes('Instant'))     return 'Éphémère';
  if (typeLine.includes('Sorcery'))     return 'Rituel';
  if (typeLine.includes('Enchantment')) return 'Enchantement';
  if (typeLine.includes('Artifact'))    return 'Artefact';
  return 'Autre';
}

export interface GeneratedDeck {
  commander: ScryfallCard;
  cards: DeckCard[];
  totalCards: number;
  totalPrice: number;
  budgetUsed: number;
  byRole: Record<string, DeckCard[]>;
}

export interface SlotCounts {
  Rampe: number;
  Pioche: number;
  Suppression: number;
  Balayage: number;
  Synergie: number;
  totalLands: number; // terrains basiques + non-basiques
}

export const DEFAULT_SLOT_COUNTS: SlotCounts = {
  Rampe: 10,
  Pioche: 10,
  Suppression: 8,
  Balayage: 3,
  Synergie: 31,
  totalLands: 37,
};

// ─── Logger ────────────────────────────────────────────────────────────────
function ts() {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
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

export interface ProgressEvent {
  step: string;
  cardImage?: string; // URL de l'image d'une carte ajoutée
}

// ─── generateDeck ──────────────────────────────────────────────────────────
export async function generateDeck(
  commander: ScryfallCard,
  budgetEur: number,
  onProgress?: (event: ProgressEvent) => void,
  slotCounts: SlotCounts = DEFAULT_SLOT_COUNTS
): Promise<GeneratedDeck> {
  const globalStart = Date.now();
  log.info(`Génération démarrée`, {
    commander: commander.name,
    colors: commander.color_identity,
    budget: `${budgetEur}€`,
    slots: slotCounts,
  });

  const ci = colorIdentityQuery(commander.color_identity);

  const { totalLands, ...deckSlotCounts } = slotCounts;
  // Budget disponible pour les cartes non-basic (réserve pour les terres basiques)
  const basicLandReserve = totalLands * 0.10;
  const totalNonBasicTarget = Object.values(deckSlotCounts).reduce((s, v) => s + v, 0) + totalLands;
  let remainingBudget = budgetEur - basicLandReserve;
  let remainingCards = totalNonBasicTarget;

  // Prix moyen cible par carte
  const avgTargetPrice = remainingBudget / remainingCards;
  // Plafond absolu par carte : 15% du budget, min 2€, max 5x le prix moyen (permet les grosses cartes)
  const hardCap = Math.max(Math.min(budgetEur * 0.15, avgTargetPrice * 5), 2);
  // Seuil Scryfall : on cherche des cartes jusqu'à 3x le prix moyen cible (on filtrera localement)
  const scryfallPriceCap = Math.max(avgTargetPrice * 3, 10);

  log.info(`Budget disponible non-basic : ${remainingBudget.toFixed(2)}€ pour ${remainingCards} cartes`);
  log.info(`Plafond absolu : ${hardCap.toFixed(2)}€/carte | Seuil Scryfall : ${scryfallPriceCap.toFixed(2)}€ | Prix moyen cible : ${avgTargetPrice.toFixed(2)}€`);

  const usedNames = new Set<string>([commander.name]);

  onProgress?.({ step: 'edhrec' });
  const t0 = Date.now();
  const edhrecNames = await getEdhrecRecommendations(commander.name);
  log.info(`EDHREC : ${edhrecNames.length} recommandations récupérées (${Date.now() - t0}ms)`);

  const allDeckCards: DeckCard[] = [];
  let totalPrice = 0;

  // Helper pour notifier une carte ajoutée avec délai pour l'animation
  const cardQueue: string[] = [];
  let isProcessingQueue = false;

  const processCardQueue = async () => {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    while (cardQueue.length > 0) {
      const img = cardQueue.shift();
      if (img) {
        onProgress?.({ step: 'card', cardImage: img });
        await new Promise(resolve => setTimeout(resolve, 150)); // 150ms entre chaque carte
      }
    }
    isProcessingQueue = false;
  };

  const notifyCard = (card: ScryfallCard) => {
    const img = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small;
    if (img) {
      cardQueue.push(img);
      processCardQueue();
    }
  };

  // ── Remplir chaque slot ────────────────────────────────────────────────
  for (const slot of DECK_SLOTS) {
    onProgress?.({ step: slot.role });
    const slotStart = Date.now();
    const target = slot.role === 'Terrains non basiques'
      ? totalLands
      : (deckSlotCounts[slot.role as keyof typeof deckSlotCounts] ?? slot.count);
    let needed = target;

    // Slot Synergie : batch EDHREC
    if (slot.role === 'Synergie' && edhrecNames.length > 0) {
      const t1 = Date.now();
      const batch = await fetchCardsByNames(edhrecNames);
      log.info(`Synergie batch Scryfall : ${batch.length} cartes reçues (${Date.now() - t1}ms)`);

      const edhrecOrder = new Map(edhrecNames.map((n, i) => [n.toLowerCase(), i]));
      batch.sort((a, b) => {
        const ia = edhrecOrder.get(a.name.toLowerCase()) ?? 9999;
        const ib = edhrecOrder.get(b.name.toLowerCase()) ?? 9999;
        return ia - ib;
      });

      let skippedPrice = 0, skippedUsed = 0, skippedIllegal = 0;
      const roleWeight = BUDGET_WEIGHTS['Synergie'] ?? 1.0;
      for (const card of batch) {
        if (needed <= 0) break;
        if (usedNames.has(card.name))               { skippedUsed++;    continue; }
        if (card.legalities?.commander !== 'legal') { skippedIllegal++; continue; }
        if (card.type_line?.includes('Land'))        { continue; } // handled by Terrains slot
        const price = getEurPrice(card);
        // Budget dynamique pondéré par le rôle
        const dynamicMax = remainingCards > 0 ? (remainingBudget / remainingCards) * roleWeight * 1.5 : hardCap;
        const maxForCard = Math.min(hardCap, Math.max(dynamicMax, avgTargetPrice * roleWeight));
        if (price <= 0 || price > maxForCard)       { skippedPrice++;   continue; }
        usedNames.add(card.name);
        totalPrice += price;
        remainingBudget -= price;
        remainingCards--;
        allDeckCards.push({ card, role: getCardTypeRole(card.type_line ?? ''), eurPrice: price, count: 1, isSynergy: true });
        notifyCard(card);
        needed--;
      }
      if (skippedPrice || skippedUsed || skippedIllegal) {
        log.warn(`Synergie cartes ignorées`, { hors_budget: skippedPrice, deja_utilisées: skippedUsed, illégales: skippedIllegal });
      }
    }

    // Fallback générique
    const slotWeight = BUDGET_WEIGHTS[slot.role] ?? 1.0;
    for (const buildQuery of slot.queries) {
      if (needed <= 0) break;
      // Seuil Scryfall élargi pour avoir plus de candidats
      const q = `${buildQuery(ci)} eur<=${scryfallPriceCap.toFixed(2)}`;
      let candidates: ScryfallCard[] = [];
      try {
        const t2 = Date.now();
        candidates = await searchCards(q);
        log.info(`  Requête fallback [${slot.role}] : ${candidates.length} résultats (${Date.now() - t2}ms)`, { q });
      } catch (err) {
        log.error(`  Requête Scryfall échouée [${slot.role}]`, { q, err: String(err) });
        candidates = [];
      }

      const filtered = candidates
        .filter(c =>
          c.legalities?.commander === 'legal' &&
          !usedNames.has(c.name) &&
          getEurPrice(c) > 0
        )
        .sort((a, b) => (a.edhrec_rank ?? 99999) - (b.edhrec_rank ?? 99999));

      for (const card of filtered) {
        if (needed <= 0) break;
        const price = getEurPrice(card);
        // Budget dynamique pondéré par le rôle
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

  // ── Passe d'upgrade : utiliser le budget restant ─────────────────────────
  const upgradeThreshold = budgetEur * 0.10; // On upgrade si > 10% du budget reste
  if (remainingBudget > upgradeThreshold) {
    onProgress?.({ step: 'Upgrade' });
    const upgradeStart = Date.now();
    log.info(`Passe d'upgrade démarrée`, { budget_restant: `${remainingBudget.toFixed(2)}€`, seuil: `${upgradeThreshold.toFixed(2)}€` });

    // Trier les cartes du deck par prix croissant (candidates à l'upgrade)
    const upgradeCandidates = allDeckCards
      .filter(dc => dc.role !== 'Terrains basiques' && dc.role !== 'Terrains non basiques')
      .sort((a, b) => a.eurPrice - b.eurPrice);

    let upgradeCount = 0;
    const maxUpgrades = Math.min(10, Math.floor(remainingBudget / 2)); // Max 10 upgrades ou budget/2

    for (const candidate of upgradeCandidates) {
      if (upgradeCount >= maxUpgrades || remainingBudget < 1) break;

      // Budget disponible pour l'upgrade de cette carte
      const upgradebudget = candidate.eurPrice + Math.min(remainingBudget * 0.3, hardCap - candidate.eurPrice);
      if (upgradebudget <= candidate.eurPrice + 0.5) continue; // Pas assez de marge

      // Chercher une meilleure carte dans le même rôle
      const roleQuery = DECK_SLOTS.find(s => s.role === candidate.role)?.queries[0];
      if (!roleQuery) continue;

      const q = `${roleQuery(ci)} eur>${candidate.eurPrice.toFixed(2)} eur<=${upgradebudget.toFixed(2)}`;
      try {
        const upgrades = await searchCards(q);
        const validUpgrades = upgrades
          .filter(c =>
            c.legalities?.commander === 'legal' &&
            !usedNames.has(c.name) &&
            getEurPrice(c) > candidate.eurPrice &&
            (c.edhrec_rank ?? 99999) < (candidate.card.edhrec_rank ?? 99999) // Meilleur classement EDHREC
          )
          .sort((a, b) => (a.edhrec_rank ?? 99999) - (b.edhrec_rank ?? 99999));

        if (validUpgrades.length > 0) {
          const upgrade = validUpgrades[0];
          const newPrice = getEurPrice(upgrade);
          const priceDiff = newPrice - candidate.eurPrice;
          const oldName = candidate.card.name;

          // Effectuer l'upgrade
          usedNames.delete(candidate.card.name);
          usedNames.add(upgrade.name);
          candidate.card = upgrade;
          candidate.eurPrice = newPrice;
          totalPrice += priceDiff;
          remainingBudget -= priceDiff;
          upgradeCount++;
          notifyCard(upgrade);

          log.info(`  Upgrade: ${oldName} → ${upgrade.name} (+${priceDiff.toFixed(2)}€)`);
        }
      } catch {
        // Ignorer les erreurs de recherche pour les upgrades
      }
    }

    log.info(`Passe d'upgrade terminée`, { upgrades: upgradeCount, budget_restant: `${remainingBudget.toFixed(2)}€`, durée: `${Date.now() - upgradeStart}ms` });
  }

  // ── Terrains basiques : comblent jusqu'à totalLands ─────────────────────
  const nonBasicLandsFound = (allDeckCards.filter(dc => dc.role === 'Terrains non basiques')).length;
  const landsNeeded = Math.max(0, totalLands - nonBasicLandsFound);
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
    if (count <= 0) continue; // Ne pas ajouter de terrains basiques si count = 0
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

  if (totalCards < 99) {
    log.warn(`Deck incomplet : ${totalCards}/99 cartes`);
  }

  // Attendre que toutes les cartes soient envoyées pour l'animation
  while (cardQueue.length > 0 || isProcessingQueue) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return {
    commander,
    cards: allDeckCards,
    totalCards,
    totalPrice: Math.round(totalPrice * 100) / 100,
    budgetUsed: Math.round((totalPrice / budgetEur) * 100),
    byRole,
  };
}
