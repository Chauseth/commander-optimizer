import { describe, expect, it } from 'vitest';
import { computeSlotCounts, detectArchetype, FUNCTIONAL_SLOTS } from './formula';
import { dispatchPool } from './pool';
import { scoreCard } from './scoring';
import { buildSynergyDescriptors } from './slots';
import { Slot } from './types';
import { archetypeTags, commanders, poolEntry, scoreContext } from './__fixtures__/golden';

function slotTotal(counts: ReturnType<typeof computeSlotCounts>['counts']): number {
  return FUNCTIONAL_SLOTS.reduce((sum, key) => sum + counts[key], counts.totalLands);
}

function emptyTargets(overrides: Partial<Record<Slot, number>>): Record<Slot, number> {
  return {
    ramp: 0,
    'mana-fix': 0,
    draw: 0,
    tutor: 0,
    'spot-removal': 0,
    counterspell: 0,
    'board-wipe': 0,
    protection: 0,
    finisher: 0,
    synergy: 0,
    ...overrides,
  };
}

describe('golden deckbuilding invariants', () => {
  it('keeps representative commander archetypes stable', () => {
    expect(detectArchetype(commanders.atraxa, [])).toBe('+1/+1-counters');
    expect(detectArchetype(commanders.lightPaws, [])).toBe('aura-voltron');
    expect(detectArchetype(commanders.talrand, [])).toBe('spellslinger');
    expect(detectArchetype(commanders.meren, archetypeTags.meren ?? [])).toBe('aristocrats');
  });

  it('keeps generated slot plans legal and color-aware', () => {
    for (const commander of Object.values(commanders)) {
      const { counts } = computeSlotCounts(commander, archetypeTags[commander.name as keyof typeof archetypeTags] ?? []);
      expect(slotTotal(counts)).toBe(99);
    }

    expect(computeSlotCounts(commanders.gruul, []).counts.counterspell).toBe(0);
    expect(computeSlotCounts(commanders.threeColor, []).counts['mana-fix']).toBeGreaterThan(0);
  });

  it('only emits tribal synergy descriptors for meaningful tribal text', () => {
    const incidental = buildSynergyDescriptors(commanders.atraxa, []);
    const tribal = buildSynergyDescriptors({
      ...commanders.gruul,
      type_line: 'Legendary Creature \u2014 Goblin Warrior',
      oracle_text: 'Other Goblins you control get +1/+1. Whenever a Goblin attacks, draw a card.',
    }, []);

    expect(incidental.some(d => d.id.startsWith('syn.tribal.'))).toBe(false);
    expect(tribal.some(d => d.id === 'syn.tribal.goblin')).toBe(true);
  });

  it('scores synergistic, archetype-fitting, multi-role cards above generic cards', () => {
    const synergistic = poolEntry({
      name: 'Fixture Sacrifice Engine',
      slots: ['synergy', 'draw', 'spot-removal'],
      price: 1.5,
      queryIds: ['fixture.synergy', 'fixture.secondary'],
      tagMatches: ['sacrifice', 'death-trigger'],
      oracleText: 'Whenever another creature dies, you may sacrifice a creature. If you do, draw a card.',
      edhrecRank: 2000,
    });
    const generic = poolEntry({
      name: 'Fixture Generic Creature',
      slots: ['synergy'],
      price: 1.5,
      queryIds: ['fixture.query'],
      oracleText: 'A reliable creature with no special deckbuilding text.',
      edhrecRank: 2000,
    });

    const ctx = scoreContext('aristocrats');
    expect(scoreCard(synergistic, ctx).total).toBeGreaterThan(scoreCard(generic, ctx).total);
  });

  it('dispatches rare slots before synergy without duplicates or over-budget cards', () => {
    const pool = [
      poolEntry({ name: 'Flexible Counterspell', slots: ['counterspell', 'synergy'], score: 100, price: 2 }),
      poolEntry({ name: 'Tutor Fixture', slots: ['tutor', 'synergy'], score: 90, price: 2 }),
      poolEntry({ name: 'Synergy Fixture A', slots: ['synergy'], score: 80, price: 2 }),
      poolEntry({ name: 'Synergy Fixture B', slots: ['synergy'], score: 70, price: 2 }),
      poolEntry({ name: 'Too Expensive Fixture', slots: ['synergy'], score: 200, price: 10 }),
    ];

    const assigned = dispatchPool(pool, {
      targets: emptyTargets({ counterspell: 1, tutor: 1, synergy: 2 }),
      budget: 12,
      hardCap: 4,
      avgTargetPrice: 3,
      budgetWeights: emptyTargets({
        counterspell: 1,
        tutor: 1,
        synergy: 1,
      }),
      usedNames: new Set(['Fixture Commander']),
    });

    expect(assigned).toHaveLength(4);
    expect(assigned.map(a => a.slot)).toEqual(['counterspell', 'tutor', 'synergy', 'synergy']);
    expect(new Set(assigned.map(a => a.entry.card.name)).size).toBe(assigned.length);
    expect(assigned.some(a => a.entry.card.name === 'Too Expensive Fixture')).toBe(false);
    expect(assigned.filter(a => a.entry.card.name === 'Flexible Counterspell')).toHaveLength(1);
    expect(assigned.reduce((sum, a) => sum + a.price, 0)).toBeLessThanOrEqual(12);
  });
});
