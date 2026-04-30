import { describe, expect, it } from 'vitest';
import { computeSlotCounts, detectArchetype, FUNCTIONAL_SLOTS } from './formula';
import { ScryfallCard } from './scryfall';

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: overrides.id ?? 'test-card',
    name: overrides.name ?? 'Test Commander',
    type_line: overrides.type_line ?? 'Legendary Creature',
    oracle_text: overrides.oracle_text ?? '',
    color_identity: overrides.color_identity ?? [],
    mana_cost: overrides.mana_cost,
    cmc: overrides.cmc ?? 4,
    edhrec_rank: overrides.edhrec_rank,
    prices: overrides.prices ?? {},
    legalities: overrides.legalities ?? { commander: 'legal' },
    scryfall_uri: overrides.scryfall_uri ?? 'https://scryfall.com',
  };
}

function slotTotal(counts: ReturnType<typeof computeSlotCounts>['counts']): number {
  return FUNCTIONAL_SLOTS.reduce((sum, key) => sum + counts[key], counts.totalLands);
}

describe('Commander slot formula', () => {
  it('does not classify Atraxa as tribal only because of creature subtypes', () => {
    const atraxa = card({
      name: "Atraxa, Praetors' Voice",
      type_line: 'Legendary Creature \u2014 Phyrexian Angel Horror',
      oracle_text: 'Flying, vigilance, deathtouch, lifelink. At the beginning of your end step, proliferate.',
      color_identity: ['W', 'U', 'B', 'G'],
      cmc: 4,
    });

    expect(detectArchetype(atraxa, [])).toBe('+1/+1-counters');
  });

  it('detects Light-Paws as aura-voltron', () => {
    const lightPaws = card({
      name: "Light-Paws, Emperor's Voice",
      type_line: 'Legendary Creature \u2014 Fox Advisor',
      oracle_text: 'Whenever an Aura enters the battlefield under your control, if you cast it, you may search your library for an Aura card.',
      color_identity: ['W'],
      cmc: 2,
    });

    expect(detectArchetype(lightPaws, [])).toBe('aura-voltron');
  });

  it('forces counterspell slots to zero without blue color identity', () => {
    const commander = card({
      color_identity: ['R', 'G'],
      oracle_text: 'Whenever you cast a creature spell, draw a card.',
    });

    expect(computeSlotCounts(commander, []).counts.counterspell).toBe(0);
  });

  it('adds mana fixing for three-color commanders', () => {
    const commander = card({
      color_identity: ['W', 'B', 'G'],
    });

    expect(computeSlotCounts(commander, []).counts['mana-fix']).toBeGreaterThan(0);
  });

  it('keeps generated slot distributions at 99 cards', () => {
    const commanders = [
      card({ name: 'Mono White', color_identity: ['W'], cmc: 2 }),
      card({ name: 'Three Color', color_identity: ['W', 'U', 'B'], cmc: 4 }),
      card({ name: 'Five Color', color_identity: ['W', 'U', 'B', 'R', 'G'], cmc: 6 }),
    ];

    for (const commander of commanders) {
      expect(slotTotal(computeSlotCounts(commander, []).counts)).toBe(99);
    }
  });
});
