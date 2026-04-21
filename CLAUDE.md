# Commander Optimizer — Documentation projet

## Vue d'ensemble

Web app Next.js qui génère des decks Commander (Magic: The Gathering) optimisés selon un Commander choisi et un budget en euros. Les prix sont récupérés en temps réel via l'API Scryfall (qui agrège les prix Cardmarket).

**Stack :** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Scryfall API (gratuite, sans clé)

---

## Architecture

```
commander-optimizer/
├── app/
│   ├── page.tsx                      # UI principale (formulaire + résultats)
│   └── api/
│       ├── generate-deck/route.ts    # POST /api/generate-deck
│       └── autocomplete/route.ts     # GET /api/autocomplete?q=
├── lib/
│   ├── types.ts                      # Interfaces TypeScript partagées (DeckCard, GeneratedDeck, SlotCounts, ProgressEvent)
│   ├── scoring.ts                    # Évaluation des cartes (detectRoles, scoreCard, ROLE_PATTERNS, TAG_TO_PATTERN)
│   ├── slots.ts                      # Définitions des slots (DECK_SLOTS, buildSynergyQueries, BUDGET_WEIGHTS, DEFAULT_SLOT_COUNTS)
│   ├── scryfall.ts                   # Client Scryfall API + Tagger GraphQL (getTaggerOracleTags)
│   └── deckBuilder.ts                # Orchestration : generateDeck(), logger, file d'animation UI
```

---

## Flux principal

1. L'utilisateur tape un nom de Commander → autocomplete via `/api/autocomplete` → `scryfall.ts:autocomplete()`
2. L'utilisateur soumet Commander + budget → POST `/api/generate-deck`
3. `route.ts` récupère la carte Commander via `scryfall.ts:getCommander()`
4. `deckBuilder.ts:generateDeck()` construit le deck
5. Le résultat est affiché groupé par rôle dans `page.tsx`

---

## Algorithme de génération (`lib/deckBuilder.ts`)

### Distribution cible (99 cartes hors Commander)
| Rôle | Cartes | Description |
|------|--------|-------------|
| Rampe | 10 | Mana rocks, sorts et créatures qui cherchent des terres |
| Pioche | 10 | Instants/rituels/enchantements/créatures qui font piocher |
| Suppression | 8 | Removal ciblé (toutes typologies) |
| Balayage | 3 | Mass removal |
| Synergie | 31 | Cartes synergiques avec le Commander |
| Terres non-basic | max 29 | Terres utilitaires (plafonné pour garantir des basics) |
| Terres basiques | min 8 | Toujours au moins 8 pour les sorts de ramp (Cultivate, Farseek...) |

### Logique de remplissage
- Chaque slot a **plusieurs requêtes Scryfall en fallback** (inclut désormais les créatures pour tous les slots)
- Les cartes sont scorées via `scoreCard()` : popularité EDHREC + bonus synergie Commander + bonus multi-rôle
- `detectRoles()` détecte les rôles fonctionnels depuis `oracle_text` (sans appel API)
- Déduplication stricte par nom de carte (Commander inclus)
- Terres basiques groupées (ex: `8× Swamp`)

### Synergie Commander (`lib/slots.ts:buildSynergyQueries`)
1. Tags oracle du Commander via Tagger Scryfall (GraphQL non documenté, CSRF token)
2. Requêtes `otag:TAG type:creature` (créatures synergiques) puis `otag:TAG` (non-créatures : Grave Pact, Ashnod's Altar...)
3. Fallback tribal : sous-types du `type_line` du Commander (ex: `type:dragon`)
4. Fallback générique `type:creature`

### Scoring (`lib/scoring.ts:scoreCard`)
- **Popularité** : `max(0, 100 - edhrec_rank / 1000)`
- **Bonus synergie** : +15 par tag Commander trouvé dans `oracle_text` (via `TAG_TO_PATTERN`)
- **Bonus multi-rôle** : +10 par rôle fonctionnel supplémentaire couvert (ramp ET draw, etc.)

### Requêtes Scryfall importantes
- `id<=WUB` = identité de couleur ≤ WUB
- `format:commander` = légal en Commander
- `order=edhrec` = tri par popularité Commander
- `eur<=X` = prix Cardmarket ≤ X€
- `otag:TAG` = oracle tag Scryfall (ex: `otag:sacrifice`, `otag:reanimate-creature`)
- **Attention** : `t:instant,sorcery` en Scryfall = ET (impossible). Toujours `(type:instant OR type:sorcery)`.

---

## API Scryfall utilisée (`lib/scryfall.ts`)

| Fonction | Endpoint | Usage |
|----------|----------|-------|
| `getCommander(name)` | `/cards/named?exact=` + fuzzy fallback | Récupère une carte par nom |
| `autocomplete(query)` | `/cards/autocomplete?q=` | Suggestions de noms |
| `searchCards(query)` | `/cards/search?q=&order=edhrec` | Recherche filtrée |
| `getTaggerOracleTags(card)` | `tagger.scryfall.com/graphql` | Oracle tags du Commander (GraphQL + CSRF) |
| `colorIdentityQuery(colors)` | — | Génère `id<=WUBGR` |
| `getEurPrice(card)` | — | Prix `.prices.eur` en float |
| `getCardImage(card)` | — | URL image (gère les double-faces) |

**Pas de clé API requise.** Rate limit Scryfall : 10 req/s. `getTaggerOracleTags` fait 2 requêtes HTTP (GET page + POST GraphQL).

---

## Interface (`app/page.tsx`)

- **Autocomplete** : debounce 300ms sur le champ Commander, appel `/api/autocomplete`
- **CardSmall** : composant carte avec hover → prévisualisation image, lien Cardmarket, affichage `Nx` pour les terres groupées
- **Export texte** : format `N NomDeCarte` compatible Moxfield/Archidekt

---

## Points d'amélioration identifiés (backlog)

- [ ] Import de collection (CSV Moxfield/Archidekt) pour filtrer sur les cartes possédées
- [ ] Pagination Scryfall pour augmenter le pool de candidats (actuellement page 1 = 175 cartes max)
- [ ] Cache des résultats Scryfall pour éviter les appels répétés (même Commander/budget)
- [ ] Modèle freemium : fonctionnalités avancées derrière auth (NextAuth + Supabase)
- [x] Prise en compte du Commander dans les requêtes de synergie → oracle tags via Tagger Scryfall
- [x] Déploiement Vercel (zero-config avec ce stack)

---

## Lancer le projet

```bash
npm install
npm run dev
# → http://localhost:3000
```

Aucune variable d'environnement requise.
