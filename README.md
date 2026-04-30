# Commander Optimizer

Commander Optimizer genere des listes Commander budget pour Magic: The Gathering.
L'application prend un commander et un budget en euros, detecte un archetype, puis
assemble un deck de 99 cartes autour de slots fonctionnels: rampe, pioche,
tuteurs, removals, contresorts, protection, finishers, synergies et terrains.

## Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Vitest pour les tests unitaires du moteur
- Scryfall et Scryfall Tagger comme sources de donnees

## Architecture

- `app/page.tsx`: interface principale, formulaire, animation de generation,
  affichage du deck et export texte.
- `app/api/generate-deck/route.ts`: route stream NDJSON qui valide la requete,
  resout le commander, lit/ecrit le cache et lance le moteur.
- `lib/scryfall.ts`: client Scryfall, autocomplete, recherche paginee, prix EUR
  et lecture best-effort des tags Tagger.
- `lib/formula.ts`: detection d'archetype et calcul dynamique des slots.
- `lib/slots.ts`: descriptors Scryfall par slot et descriptors de synergie.
- `lib/pool.ts`: construction du pool commun et dispatch glouton.
- `lib/scoring.ts`: score vectoriel des cartes candidates.
- `lib/validation.ts`: validation pure des entrees serveur.

## Commandes locales

```bash
npm install
npm run dev
npm run lint
npm run build
npm test
```

Le serveur de dev expose l'application sur `http://localhost:3000`.

## Qualite

La CI GitHub Actions s'execute sur `master` et sur les pull requests vers
`master`. Elle lance:

```bash
npm ci
npm run lint
npm run build
npm test
```

Les tests unitaires couvrent les fonctions pures du moteur, notamment la
detection d'archetype, la repartition des slots, les helpers tribaux et la
validation des entrees de generation.

## Commanders utiles pour tester

- Atraxa, Praetors' Voice: doit favoriser les strategies counters/proliferate,
  sans etre classee tribal uniquement a cause de ses sous-types.
- Light-Paws, Emperor's Voice: doit etre detectee comme aura-voltron.
- Talrand, Sky Summoner: bon cas spellslinger mono-bleu.
- Meren of Clan Nel Toth: bon cas graveyard/reanimator.
- Un commander sans bleu: doit produire zero contresort.
- Un commander trois couleurs ou plus: doit activer du mana-fixing.

## Limites connues

- Les prix viennent de Scryfall et peuvent etre absents ou differer du prix reel
  Cardmarket au moment de l'achat.
- L'integration Tagger utilise une route GraphQL non documentee. Si Tagger change
  son fonctionnement, l'application degrade vers moins de signaux de synergie.
- Le moteur est heuristique: il cherche une liste budget coherente, pas une liste
  competitive parfaite ni une simulation de metagame.
- Le cache est en memoire process, avec une duree de vie d'une heure. Il n'est
  pas partage entre instances.
