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
│   ├── scryfall.ts                   # Client Scryfall API + helpers
│   └── deckBuilder.ts                # Algorithme de génération de deck
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
| Rampe | 10 | Mana rocks (artefacts), sorts qui cherchent des terres |
| Pioche | 10 | Instants/rituels/enchantements qui font piocher |
| Suppression | 8 | Removal ciblé (instants + rituels) |
| Balayage | 3 | Mass removal (rituels) |
| Synergie | 31 | Créatures synergiques |
| Terres non-basic | 10 | Terres utilitaires |
| Terres basiques | max 27 | Complément, plafonné à 27 |

### Logique de remplissage
- Chaque slot a **plusieurs requêtes Scryfall en fallback** : si la première ne remplit pas le quota, on tente la suivante
- Les cartes sont triées par `edhrec_rank` (popularité Commander sur EDHREC, champ natif Scryfall)
- Filtre prix : `eur <= min(budget × 20%, 30€)` avec plancher à 1€
- Déduplication stricte par nom de carte (Commander inclus)
- Terres basiques groupées (ex: `27× Plains` au lieu de 27 lignes séparées)

### Requêtes Scryfall importantes
- `id<=WUB` = identité de couleur ≤ WUB (cartes jouables dans ce Commander)
- `format:commander` = légal en Commander
- `order=edhrec` = tri par popularité Commander
- `eur<=X` = prix Cardmarket ≤ X€
- **Attention** : `t:instant,sorcery` en Scryfall = ET (impossible). Toujours utiliser `(type:instant OR type:sorcery)` ou des requêtes séparées.

---

## API Scryfall utilisée (`lib/scryfall.ts`)

| Fonction | Endpoint | Usage |
|----------|----------|-------|
| `getCommander(name)` | `/cards/named?fuzzy=` | Récupère une carte par nom approx. |
| `autocomplete(query)` | `/cards/autocomplete?q=` | Suggestions de noms |
| `searchCards(query)` | `/cards/search?q=&order=edhrec` | Recherche filtrée |
| `colorIdentityQuery(colors)` | — | Génère `id<=WUBGR` |
| `getEurPrice(card)` | — | Prix `.prices.eur` en float |
| `getCardImage(card)` | — | URL image (gère les double-faces) |

**Pas de clé API requise.** Rate limit Scryfall : 10 req/s. Les appels sont séquentiels dans `generateDeck()`.

---

## Interface (`app/page.tsx`)

- **Autocomplete** : debounce 300ms sur le champ Commander, appel `/api/autocomplete`
- **CardSmall** : composant carte avec hover → prévisualisation image, lien Cardmarket, affichage `Nx` pour les terres groupées
- **Export texte** : format `N NomDeCarte` compatible Moxfield/Archidekt

---

## Points d'amélioration identifiés (backlog)

- [ ] Import de collection (CSV Moxfield/Archidekt) pour filtrer sur les cartes possédées
- [ ] Prise en compte du Commander dans les requêtes de synergie (mots-clés dans son oracle text)
- [ ] Pagination Scryfall pour augmenter le pool de candidats (actuellement page 1 = 175 cartes max)
- [ ] Cache des résultats Scryfall pour éviter les appels répétés (même Commander/budget)
- [ ] Modèle freemium : fonctionnalités avancées derrière auth (NextAuth + Supabase)
- [ ] Déploiement Vercel (zero-config avec ce stack)

---

## Lancer le projet

```bash
npm install
npm run dev
# → http://localhost:3000
```

Aucune variable d'environnement requise pour le MVP.
