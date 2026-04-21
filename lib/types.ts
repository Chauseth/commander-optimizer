import { ScryfallCard } from './scryfall';

export interface DeckCard {
  card: ScryfallCard;
  role: string;
  eurPrice: number;
  count: number;
  isSynergy?: boolean;
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
  totalLands: number;
}

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
