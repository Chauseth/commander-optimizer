import type { GeneratedDeck } from './types';

const TTL_MS = 60 * 60 * 1000; // 1h
const MAX_ENTRIES = 50;

interface Entry {
  deck: GeneratedDeck;
  expiresAt: number;
}

// Module-level store — persiste entre les requêtes dans le même process Node.js
const store = new Map<string, Entry>();

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
}

export function buildCacheKey(
  commanderName: string,
  budget: number,
  slotCountsOverride?: object,
): string {
  const counts = slotCountsOverride
    ? JSON.stringify(Object.entries(slotCountsOverride).sort())
    : '';
  return `${commanderName}:${budget}:${counts}`;
}

export function getCached(key: string): GeneratedDeck | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  // LRU : déplacer en fin de Map pour l'éviction
  store.delete(key);
  store.set(key, entry);
  return entry.deck;
}

export function setCached(key: string, deck: GeneratedDeck): void {
  evictExpired();
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  store.set(key, { deck, expiresAt: Date.now() + TTL_MS });
}

export function getCacheStats(): { size: number; maxSize: number; ttlMin: number } {
  return { size: store.size, maxSize: MAX_ENTRIES, ttlMin: TTL_MS / 60_000 };
}
