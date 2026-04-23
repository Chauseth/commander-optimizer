const BASE = 'https://api.scryfall.com';

const HEADERS = { 'User-Agent': 'CommanderOptimizer/1.0 (contact: milsilv3r@gmail.com)' };

async function fetchWithRetry(url: string, options?: RequestInit, retries = 3): Promise<Response> {
  let lastRes: Response | null = null;
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, { ...options, headers: { ...HEADERS, ...(options?.headers ?? {}) } });
    if (res.ok || (res.status !== 429 && res.status < 500)) return res;
    lastRes = res;
    const retryAfter = res.headers.get('Retry-After');
    const delay = retryAfter ? parseInt(retryAfter) * 1000 : (i + 1) * 600;
    await new Promise(r => setTimeout(r, delay));
  }
  return lastRes!;
}

export interface ScryfallCard {
  id: string;
  name: string;
  type_line: string;
  oracle_text?: string;
  color_identity: string[];
  mana_cost?: string;
  cmc: number;
  edhrec_rank?: number;
  prices: {
    eur?: string;
    eur_foil?: string;
  };
  image_uris?: {
    normal: string;
    small: string;
  };
  card_faces?: Array<{
    image_uris?: { normal: string; small: string };
  }>;
  legalities: { commander: string };
  scryfall_uri: string;
}

// Récupère un Commander par son nom exact ou approximatif
export async function getCommander(name: string): Promise<ScryfallCard> {
  const exactRes = await fetchWithRetry(`${BASE}/cards/named?exact=${encodeURIComponent(name)}`);
  if (exactRes.ok) return exactRes.json();

  const fuzzyRes = await fetchWithRetry(`${BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`);
  if (fuzzyRes.ok) return fuzzyRes.json();

  throw new Error(`Commander "${name}" introuvable`);
}

// Autocomplete filtré sur les cartes éligibles Commander (is:commander)
export async function autocomplete(query: string): Promise<string[]> {
  const res = await fetchWithRetry(
    `${BASE}/cards/search?q=${encodeURIComponent(query + ' is:commander')}&order=name&unique=names`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data as ScryfallCard[] || []).map((c: ScryfallCard) => c.name);
}

// ─── Cache LRU mémoire pour searchCards ───────────────────────────────────
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const SEARCH_CACHE_MAX = 200;
const searchCache = new Map<string, { cards: ScryfallCard[]; expiresAt: number }>();

function cacheGet(key: string): ScryfallCard[] | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) { searchCache.delete(key); return null; }
  // LRU : remettre en queue d'insertion
  searchCache.delete(key);
  searchCache.set(key, entry);
  return entry.cards;
}

function cacheSet(key: string, cards: ScryfallCard[]) {
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
  searchCache.set(key, { cards, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
}

// Cherche des cartes avec un filtre Scryfall (pagination optionnelle)
export async function searchCards(query: string, maxPages = 1): Promise<ScryfallCard[]> {
  const cacheKey = `${maxPages}|${query}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const all: ScryfallCard[] = [];
  let url: string | null = `${BASE}/cards/search?q=${encodeURIComponent(query)}&order=edhrec&dir=asc`;
  let page = 0;
  while (url && page < maxPages) {
    const res: Response = await fetchWithRetry(url);
    if (!res.ok) break;
    const data: { data?: ScryfallCard[]; has_more?: boolean; next_page?: string } = await res.json();
    if (data.data) all.push(...data.data);
    page++;
    url = data.has_more && data.next_page ? data.next_page : null;
    if (url) await new Promise(r => setTimeout(r, 100)); // rate-limit Scryfall
  }
  cacheSet(cacheKey, all);
  return all;
}

// Formate l'identité de couleur pour les requêtes Scryfall
export function colorIdentityQuery(colors: string[]): string {
  if (colors.length === 0) return 'id:colorless';
  return `id<=${colors.join('')}`;
}

// Retourne l'image d'une carte (gère les double-faces)
export function getCardImage(card: ScryfallCard): string {
  if (card.image_uris?.normal) return card.image_uris.normal;
  if (card.card_faces?.[0]?.image_uris?.normal) return card.card_faces[0].image_uris.normal;
  return '';
}

// Prix en euros (0 si non disponible)
export function getEurPrice(card: ScryfallCard): number {
  return parseFloat(card.prices?.eur || '0') || 0;
}

// Récupère les oracle tags du Commander via le Tagger Scryfall (GraphQL non documenté)
export async function getTaggerOracleTags(card: ScryfallCard): Promise<string[]> {
  try {
    // Récupère le token CSRF + session cookie depuis la page Tagger
    const pageRes = await fetch('https://tagger.scryfall.com/', { headers: HEADERS });
    if (!pageRes.ok) return [];
    const html = await pageRes.text();
    const csrfMatch = html.match(/name="csrf-token"\s+content="([^"]+)"/);
    if (!csrfMatch) return [];
    const csrfToken = csrfMatch[1];

    // Extrait les cookies de session (getSetCookie disponible en Node 18+)
    const rawCookies: string[] =
      typeof (pageRes.headers as any).getSetCookie === 'function'
        ? (pageRes.headers as any).getSetCookie()
        : [pageRes.headers.get('set-cookie') ?? ''];
    const cookieHeader = rawCookies.map(c => c.split(';')[0]).filter(Boolean).join('; ');

    const gqlRes = await fetch('https://tagger.scryfall.com/graphql', {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'Cookie': cookieHeader,
        'Referer': 'https://tagger.scryfall.com/',
        'Origin': 'https://tagger.scryfall.com',
      },
      body: JSON.stringify({
        query: `{ card(id: "${card.id}") { taggings { tag { slug } classifier } } }`,
      }),
    });
    if (!gqlRes.ok) return [];
    const data = await gqlRes.json();

    const taggings: Array<{ tag: { slug: string }; classifier: string }> =
      data?.data?.card?.taggings ?? [];

    return taggings
      .filter(t =>
        t.classifier === 'ORACLE_CARD_TAG' &&
        !t.tag.slug.startsWith('cycle-') &&
        t.tag.slug !== 'oversized'
      )
      .map(t => t.tag.slug);
  } catch {
    return [];
  }
}
