import { ScryfallCard } from './scryfall';

export interface DeckCard {
  card: ScryfallCard;
  role: string;
  eurPrice: number;
  count: number;
  isSynergy?: boolean;
  explanation?: CardExplanation;
}

export interface CardExplanation {
  selectedSlot: string;
  score: number;
  topFactors: Array<{ label: string; value: number }>;
  matchedTags: string[];
  matchedQueries: string[];
  note?: string;
}

export interface GeneratedDeck {
  commander: ScryfallCard;
  cards: DeckCard[];
  totalCards: number;
  totalPrice: number;
  budgetUsed: number;
  byRole: Record<string, DeckCard[]>;
}

// Clés internes (anglais) — labels FR via SLOT_LABEL_FR dans slots.ts
export type Slot =
  | 'ramp'
  | 'mana-fix'
  | 'draw'
  | 'tutor'
  | 'spot-removal'
  | 'counterspell'
  | 'board-wipe'
  | 'protection'
  | 'finisher'
  | 'synergy';

export type SlotCounts = Record<Slot, number> & { totalLands: number };

export interface ProgressEvent {
  step: string;
  cardImage?: string;
  upgradeOldImage?: string;
}

export function getCardTypeRole(typeLine: string): string {
  if (typeLine.includes('Creature'))     return 'Créature';
  if (typeLine.includes('Planeswalker')) return 'Planeswalker';
  if (typeLine.includes('Instant'))      return 'Éphémère';
  if (typeLine.includes('Sorcery'))      return 'Rituel';
  if (typeLine.includes('Enchantment'))  return 'Enchantement';
  if (typeLine.includes('Artifact'))     return 'Artefact';
  return 'Autre';
}
