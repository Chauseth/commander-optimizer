import { Archetype } from '../formula';
import { PoolEntry } from '../pool';
import { ScryfallCard } from '../scryfall';
import { Slot } from '../types';

export function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: overrides.id ?? overrides.name ?? 'test-card',
    name: overrides.name ?? 'Test Card',
    type_line: overrides.type_line ?? 'Creature',
    oracle_text: overrides.oracle_text ?? '',
    color_identity: overrides.color_identity ?? [],
    mana_cost: overrides.mana_cost,
    cmc: overrides.cmc ?? 3,
    edhrec_rank: overrides.edhrec_rank,
    prices: overrides.prices ?? { eur: '1.00' },
    legalities: overrides.legalities ?? { commander: 'legal' },
    scryfall_uri: overrides.scryfall_uri ?? 'https://scryfall.com/card/test',
    image_uris: overrides.image_uris,
    card_faces: overrides.card_faces,
  };
}

export function poolEntry({
  name,
  slots,
  price = 1,
  score = 10,
  queryIds = ['fixture.query'],
  tagMatches = [],
  oracleText = '',
  typeLine = 'Creature',
  edhrecRank = 10000,
}: {
  name: string;
  slots: Slot[];
  price?: number;
  score?: number;
  queryIds?: string[];
  tagMatches?: string[];
  oracleText?: string;
  typeLine?: string;
  edhrecRank?: number;
}): PoolEntry {
  return {
    card: card({
      name,
      type_line: typeLine,
      oracle_text: oracleText,
      edhrec_rank: edhrecRank,
      prices: { eur: price.toFixed(2) },
    }),
    price,
    queryHits: new Map(queryIds.map((id, index) => [id, index])),
    slotHits: new Set(slots),
    tagMatches: new Set(tagMatches),
    score,
    scoreBreakdown: {},
  };
}

export const commanders = {
  atraxa: card({
    name: "Atraxa, Praetors' Voice",
    type_line: 'Legendary Creature \u2014 Phyrexian Angel Horror',
    oracle_text: 'Flying, vigilance, deathtouch, lifelink. At the beginning of your end step, proliferate.',
    color_identity: ['W', 'U', 'B', 'G'],
    cmc: 4,
  }),
  lightPaws: card({
    name: "Light-Paws, Emperor's Voice",
    type_line: 'Legendary Creature \u2014 Fox Advisor',
    oracle_text: 'Whenever an Aura enters the battlefield under your control, if you cast it, you may search your library for an Aura card.',
    color_identity: ['W'],
    cmc: 2,
  }),
  talrand: card({
    name: 'Talrand, Sky Summoner',
    type_line: 'Legendary Creature \u2014 Merfolk Wizard',
    oracle_text: 'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.',
    color_identity: ['U'],
    cmc: 4,
  }),
  meren: card({
    name: 'Meren of Clan Nel Toth',
    type_line: 'Legendary Creature \u2014 Human Shaman',
    oracle_text: 'Whenever another creature you control dies, you get an experience counter. At the beginning of your end step, choose target creature card in your graveyard.',
    color_identity: ['B', 'G'],
    cmc: 4,
  }),
  gruul: card({
    name: 'Ruby, Daring Tracker',
    type_line: 'Legendary Creature \u2014 Human Scout',
    oracle_text: 'Haste. Whenever you attack, add red or green mana.',
    color_identity: ['R', 'G'],
    cmc: 2,
  }),
  threeColor: card({
    name: 'Alela, Artful Provocateur',
    type_line: 'Legendary Creature \u2014 Faerie Warlock',
    oracle_text: 'Flying, deathtouch, lifelink. Whenever you cast an artifact or enchantment spell, create a 1/1 blue Faerie creature token with flying.',
    color_identity: ['W', 'U', 'B'],
    cmc: 4,
  }),
} satisfies Record<string, ScryfallCard>;

export const archetypeTags: Partial<Record<keyof typeof commanders, string[]>> = {
  meren: ['sacrifice', 'death-trigger'],
};

export function scoreContext(archetype: Archetype) {
  return {
    archetype,
    commander: commanders.atraxa,
    slotAvgBudget: 3,
    descriptorWeights: new Map([
      ['fixture.query', 1],
      ['fixture.synergy', 1],
      ['fixture.secondary', 0.6],
    ]),
  };
}
