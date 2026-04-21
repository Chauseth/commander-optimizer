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
  // Essayer d'abord une recherche exacte (plus fiable pour les noms de l'autocomplete)
  const exactRes = await fetchWithRetry(`${BASE}/cards/named?exact=${encodeURIComponent(name)}`);
  if (exactRes.ok) return exactRes.json();

  // Fallback sur recherche fuzzy
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

// Récupère plusieurs cartes par nom en une seule requête (max 75 noms)
export async function fetchCardsByNames(names: string[]): Promise<ScryfallCard[]> {
  if (names.length === 0) return [];
  const identifiers = names.slice(0, 75).map(name => ({ name }));
  const res = await fetchWithRetry(`${BASE}/cards/collection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiers }),
  });
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

// Convertit un nom de carte en slug EDHREC (ex: "Miirym, Sentinel Wyrm" → "miirym-sentinel-wyrm")
export function toEdhrecSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// Récupère les noms de cartes recommandées par EDHREC pour un commander, triées par synergie
export async function getEdhrecRecommendations(commanderName: string): Promise<string[]> {
  const slug = toEdhrecSlug(commanderName);
  try {
    const res = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`);
    if (!res.ok) return [];
    const data = await res.json();
    const cardlists: Array<{ cardviews?: Array<{ name: string; synergy?: number }> }> =
      data?.container?.json_dict?.cardlists ?? [];
    const seen = new Set<string>();
    const cards: Array<{ name: string; synergy: number }> = [];
    for (const list of cardlists) {
      for (const cv of list.cardviews ?? []) {
        if (cv.name && !seen.has(cv.name)) {
          seen.add(cv.name);
          cards.push({ name: cv.name, synergy: cv.synergy ?? 0 });
        }
      }
    }
    // Trier par synergie décroissante
    cards.sort((a, b) => b.synergy - a.synergy);
    return cards.map(c => c.name);
  } catch {
    return [];
  }
}
