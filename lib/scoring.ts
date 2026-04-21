import { ScryfallCard } from './scryfall';

const ROLE_PATTERNS: Record<string, RegExp[]> = {
  'Rampe':       [/\badd \{[mwubrgc\d]/i, /\bsearch your library\b.*\bland\b/i],
  'Pioche':      [/\bdraw [a-z\d]+ cards?\b/i, /\bdraw a card\b/i],
  'Suppression': [/\bdestroy target\b/i, /\bexile target\b/i],
  'Balayage':    [/\bdestroy all\b/i, /\bexile all\b/i, /\beach creature\b.*\bdestroy\b/i],
};

export function detectRoles(card: ScryfallCard): Set<string> {
  const text = card.oracle_text ?? '';
  const roles = new Set<string>();
  for (const [role, patterns] of Object.entries(ROLE_PATTERNS)) {
    if (patterns.some(p => p.test(text))) roles.add(role);
  }
  return roles;
}

// Approximation des oracle tags via oracle_text (bonus synergie sans appel API supplémentaire)
const TAG_TO_PATTERN: Record<string, RegExp> = {
  'sacrifice':          /\bsacrifice\b/i,
  'reanimate-creature': /\breturn\b.*\bgraveyard\b.*\bbattlefield\b/i,
  'death-trigger':      /\bwhen\b.*\bdies\b/i,
  'token-generation':   /\bcreate\b.*\btoken\b/i,
  '+1/+1-counters':     /\+1\/\+1 counter/i,
  'counters-matter':    /\bcounter\b/i,
  'lifegain':           /\bgain\b.*\blife\b/i,
  'discard':            /\bdiscard\b/i,
  'blink':              /\bexile\b.*\breturn\b/i,
  'treasure':           /\btreasure\b/i,
};

export function scoreCard(
  card: ScryfallCard,
  commanderTags: string[],
  targetRole: string,
  detectedRoles: Set<string>
): number {
  const popularity = card.edhrec_rank ? Math.max(0, 100 - card.edhrec_rank / 1000) : 0;

  const text = card.oracle_text ?? '';
  const synergyMatches = commanderTags.filter(tag => TAG_TO_PATTERN[tag]?.test(text)).length;
  const synergyBonus = synergyMatches * 15;

  const extraRoles = [...detectedRoles].filter(r => r !== targetRole).length;
  const roleBonus = extraRoles * 10;

  return popularity + synergyBonus + roleBonus;
}
