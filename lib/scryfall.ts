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

// Autocomplete pour la recherche de Commander
export async function autocomplete(query: string): Promise<string[]> {
  const res = await fetchWithRetry(`${BASE}/cards/autocomplete?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

// Cherche des cartes avec un filtre Scryfall
export async function searchCards(query: string): Promise<ScryfallCard[]> {
  const url = `${BASE}/cards/search?q=${encodeURIComponent(query)}&order=edhrec&dir=asc`;
  const res = await fetchWithRetry(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
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
