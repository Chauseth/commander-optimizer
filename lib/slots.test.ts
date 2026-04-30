import { describe, expect, it } from 'vitest';
import { buildSynergyDescriptors, hasTribalSynergy } from './slots';
import { ScryfallCard } from './scryfall';

function commander(typeLine: string, oracleText: string): ScryfallCard {
  return {
    id: 'test-commander',
    name: 'Test Commander',
    type_line: typeLine,
    oracle_text: oracleText,
    color_identity: ['G'],
    cmc: 3,
    prices: {},
    legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com',
  };
}

describe('tribal synergy helpers', () => {
  it('requires meaningful tribal text for subtype synergy', () => {
    expect(hasTribalSynergy('Soldier', 'Other Soldiers you control get +1/+1.')).toBe(true);
    expect(hasTribalSynergy('Angel', 'Flying, vigilance, deathtouch, lifelink.')).toBe(false);
  });

  it('does not build tribal descriptors from incidental subtypes', () => {
    const descriptors = buildSynergyDescriptors(
      commander('Legendary Creature \u2014 Phyrexian Angel Horror', 'At the beginning of your end step, proliferate.'),
      [],
    );

    expect(descriptors.some((descriptor) => descriptor.id.startsWith('syn.tribal.'))).toBe(false);
  });
});
