'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface CardData {
  id: string;
  name: string;
  type_line: string;
  eurPrice: number;
  role: string;
  scryfall_uri: string;
  image_uris?: { small: string };
  card_faces?: Array<{ image_uris?: { small: string } }>;
}

interface DeckCard {
  card: CardData;
  role: string;
  eurPrice: number;
  count: number;
  isSynergy?: boolean;
}

interface DeckResult {
  commander: CardData;
  cards: DeckCard[];
  totalCards: number;
  totalPrice: number;
  budgetUsed: number;
  byRole: Record<string, DeckCard[]>;
}

const ROLE_ICONS: Record<string, string> = {
  'Rampe': '⚡',
  'Pioche': '📖',
  'Suppression': '⚔️',
  'Balayage': '🌊',
  'Créature': '🐲',
  'Éphémère': '💫',
  'Rituel': '📜',
  'Enchantement': '🔮',
  'Artefact': '⚙️',
  'Planeswalker': '🌟',
  'Autre': '❓',
  'Terrains non basiques': '🗺️',
  'Terrains basiques': '🏔️',
};

function CardSmall({ card, eurPrice, count, isSynergy }: { card: CardData; eurPrice: number; count: number; isSynergy?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const img = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small;
  const isBasic = count > 1;
  const cardmarketUrl = `https://www.cardmarket.com/en/Magic/Products/Singles?searchString=${encodeURIComponent(card.name)}`;

  return (
    <div className="relative">
      <div
        className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-800 group cursor-pointer"
        onMouseEnter={() => !isBasic && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span className="text-sm text-gray-200 group-hover:text-white truncate max-w-[180px]">
          {count > 1 && (
            <span className="text-amber-500 font-semibold mr-1.5">{count}×</span>
          )}
          {isSynergy && (
            <span className="text-purple-400 mr-1 text-xs" title="Recommandé par EDHREC">✦</span>
          )}
          {card.name}
        </span>
        {isBasic ? (
          <span className="text-xs text-gray-500 ml-2 shrink-0">{eurPrice.toFixed(2)}€</span>
        ) : (
          <a
            href={cardmarketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-amber-400 hover:text-amber-300 ml-2 shrink-0"
            onClick={e => e.stopPropagation()}
          >
            {eurPrice > 0 ? `${eurPrice.toFixed(2)}€` : 'gratuit'}
          </a>
        )}
      </div>
      {hovered && img && (
        <div className="absolute z-50 left-full top-0 ml-2 pointer-events-none">
          <img src={img} alt={card.name} className="rounded-lg shadow-xl w-32" />
        </div>
      )}
    </div>
  );
}

const STEPS = [
  { key: 'commander',        label: 'Recherche du commander'      },
  { key: 'edhrec',           label: 'Recommandations EDHREC'      },
  { key: 'Rampe',            label: 'Rampe (mana)'                },
  { key: 'Pioche',           label: 'Pioche (card draw)'          },
  { key: 'Suppression',      label: 'Suppression (removal)'       },
  { key: 'Balayage',         label: 'Balayage (wipes)'            },
  { key: 'Synergie',         label: 'Cartes synergiques (EDHREC)'  },
  { key: 'Terrains non basiques', label: 'Terrains non basiques'       },
  { key: 'Upgrade',          label: 'Optimisation budget'         },
  { key: 'done',             label: 'Finalisation'                },
];

const SLOT_CONFIG = [
  { key: 'Rampe',       label: 'Rampe',       icon: '⚡', min: 0,  max: 20 },
  { key: 'Pioche',      label: 'Pioche',      icon: '📖', min: 0,  max: 20 },
  { key: 'Suppression', label: 'Suppression', icon: '⚔️', min: 0,  max: 15 },
  { key: 'Balayage',    label: 'Balayage',    icon: '🌊', min: 0,  max: 10 },
  { key: 'Synergie',    label: 'Synergies',   icon: '✦',  min: 5,  max: 50 },
] as const;

const DEFAULT_COUNTS = { Rampe: 10, Pioche: 10, Suppression: 8, Balayage: 3, Synergie: 31, totalLands: 37 };

export default function Home() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedCommander, setSelectedCommander] = useState('');
  const [budget, setBudget] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [cardImages, setCardImages] = useState<Array<{ id: number; src: string }>>([]);
  const [showCards, setShowCards] = useState(false);
  const cardIdRef = useRef(0);
  const [deck, setDeck] = useState<DeckResult | null>(null);
  const [error, setError] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({ ...DEFAULT_COUNTS });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nonLandTotal = SLOT_CONFIG.reduce((s, sl) => s + (counts[sl.key] ?? 0), 0);
  const total = nonLandTotal + (counts.totalLands ?? 37);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); return; }
    const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setSuggestions(data);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, fetchSuggestions]);

  async function handleGenerate() {
    const commander = selectedCommander || query;
    if (!commander || !budget) { setError('Remplis les deux champs.'); return; }
    setLoading(true);
    setError('');
    setDeck(null);
    setCurrentStep(null);
    setCompletedSteps([]);
    setCardImages([]);
    setShowCards(true);
    cardIdRef.current = 0;
    try {
      const res = await fetch('/api/generate-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commanderName: commander, budget, slotCounts: counts }),
      });
      if (!res.body) throw new Error('Pas de réponse du serveur');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'progress') {
            setCurrentStep(event.step);
            setCompletedSteps(prev => {
              const idx = STEPS.findIndex(s => s.key === event.step);
              return STEPS.slice(0, idx).map(s => s.key);
            });
          } else if (event.type === 'card' && event.image) {
            const id = ++cardIdRef.current;
            setCardImages(prev => [...prev, { id, src: event.image }]); // Garder toutes les cartes pour le deck
          } else if (event.type === 'done') {
            setCompletedSteps(STEPS.map(s => s.key));
            setCurrentStep(null);
            setDeck(event.deck);
            // Garder les cartes visibles 5s après la fin pour voir les dernières animations
            setTimeout(() => setShowCards(false), 5000);
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  const cmdImg = deck?.commander?.image_uris?.small || deck?.commander?.card_faces?.[0]?.image_uris?.small;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex">
      {/* Sidebar gauche : recherche + loader */}
      <aside className="w-80 shrink-0 border-r border-gray-800 flex flex-col h-screen sticky top-0">
        {/* Header */}
        <div className="border-b border-gray-800 px-4 py-4">
          <h1 className="text-lg font-bold text-amber-400">⚔️ Commander Optimizer</h1>
          <p className="text-xs text-gray-500 mt-0.5">Génère le meilleur deck Commander</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Commander search */}
          <div className="relative">
            <label className="block text-xs text-gray-400 mb-1.5">Commander</label>
            <input
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setSelectedCommander(''); }}
              placeholder="Ex: Atraxa, Praetors' Voice"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500 placeholder:text-gray-600"
            />
            {suggestions.length > 0 && !selectedCommander && (
              <ul className="absolute z-50 w-full bg-gray-800 border border-gray-700 rounded-lg mt-1 overflow-hidden shadow-xl">
                {suggestions.map(s => (
                  <li
                    key={s}
                    onClick={() => { setSelectedCommander(s); setQuery(s); setSuggestions([]); }}
                    className="px-3 py-2 text-sm hover:bg-gray-700 cursor-pointer"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Budget */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Budget (€)</label>
            <input
              type="number"
              value={budget}
              onChange={e => setBudget(e.target.value)}
              placeholder="Ex: 100"
              min="10"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500 placeholder:text-gray-600"
            />
          </div>

          {/* Options avancées */}
          <div className="border border-gray-800 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setAdvancedOpen(o => !o)}
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            >
              <span>⚙️ Options avancées</span>
              <span className="text-xs">{advancedOpen ? '▲' : '▼'}</span>
            </button>
            {advancedOpen && (
              <div className="px-3 pb-3 pt-2 bg-gray-900 border-t border-gray-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">Composition</span>
                  <span className={`text-xs font-semibold tabular-nums ${total > 99 ? 'text-red-400' : total === 99 ? 'text-green-400' : 'text-amber-400'}`}>
                    {total}/99
                  </span>
                </div>
                <div className="space-y-2">
                  {SLOT_CONFIG.map(slot => (
                    <div key={slot.key} className="flex items-center gap-2">
                      <span className="text-sm w-4 text-center shrink-0">{slot.icon}</span>
                      <input
                        type="range"
                        min={slot.min}
                        max={slot.max}
                        value={counts[slot.key]}
                        onChange={e => setCounts(prev => ({ ...prev, [slot.key]: Number(e.target.value) }))}
                        className="flex-1 h-1 accent-amber-500 cursor-pointer"
                      />
                      <span className="text-xs text-gray-400 w-5 text-right tabular-nums">{counts[slot.key]}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-2 border-t border-gray-800">
                    <span className="text-sm w-4 text-center shrink-0">🏔️</span>
                    <input
                      type="range"
                      min={28}
                      max={45}
                      value={counts.totalLands}
                      onChange={e => setCounts(prev => ({ ...prev, totalLands: Number(e.target.value) }))}
                      className="flex-1 h-1 accent-amber-500 cursor-pointer"
                    />
                    <span className="text-xs text-gray-400 w-5 text-right tabular-nums">{counts.totalLands}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCounts({ ...DEFAULT_COUNTS })}
                  className="mt-2 text-xs text-gray-500 hover:text-gray-300 underline"
                >
                  Reset
                </button>
              </div>
            )}
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-semibold rounded-lg py-2.5 text-sm transition-colors"
          >
            {loading ? '⚙️ Génération...' : '🎲 Générer'}
          </button>

          {/* Progress */}
          {loading && (
            <div className="bg-gray-900/80 rounded-xl border border-gray-800 p-4">
              <p className="text-xs text-gray-400 mb-3 uppercase tracking-wider">Progression</p>
              <div className="space-y-1.5">
                {STEPS.filter(s => s.key !== 'done').map(step => {
                  const done = completedSteps.includes(step.key);
                  const active = currentStep === step.key;
                  return (
                    <div key={step.key} className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[10px] transition-all duration-300 ${
                        done    ? 'bg-green-500 text-black'  :
                        active  ? 'bg-amber-500 text-black animate-pulse' :
                                  'bg-gray-800 text-gray-600'
                      }`}>
                        {done ? '✓' : active ? '⚙' : '·'}
                      </div>
                      <span className={`text-xs transition-colors duration-300 ${
                        done   ? 'text-gray-500 line-through' :
                        active ? 'text-white font-medium'    :
                                 'text-gray-600'
                      }`}>
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 h-1 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((completedSteps.length / (STEPS.length - 1)) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Zone centrale : animation + deck */}
      <main className="flex-1 min-h-screen relative overflow-hidden">
        {/* Animation des cartes qui forment un deck */}
        {showCards && cardImages.length > 0 && !deck && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative" style={{ width: '160px', height: '224px' }}>
              {cardImages.map(({ id, src }, index) => {
                const directions = [
                  'from-top', 'from-top-right', 'from-right', 'from-bottom-right',
                  'from-bottom', 'from-bottom-left', 'from-left', 'from-top-left'
                ];
                const direction = directions[id % directions.length];
                const stackOffset = Math.min(index, 20) * 0.4;
                const rotation = ((id % 7) - 3) * 1.5;

                return (
                  <img
                    key={id}
                    src={src}
                    alt=""
                    className={`card-to-deck absolute w-full rounded-xl shadow-2xl ${direction}`}
                    style={{
                      top: -stackOffset,
                      left: stackOffset,
                      transform: `rotate(${rotation}deg)`,
                      zIndex: index,
                    }}
                  />
                );
              })}
              {/* Compteur de cartes */}
              <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 text-center">
                <span className="text-3xl font-bold text-amber-400">{cardImages.length}</span>
                <span className="text-gray-500 text-sm ml-1">/ 99</span>
              </div>
            </div>
          </div>
        )}

        {/* État vide */}
        {!loading && !deck && cardImages.length === 0 && (
          <div className="h-full flex items-center justify-center text-gray-600">
            <div className="text-center">
              <div className="text-6xl mb-4">🃏</div>
              <p>Choisis un Commander et un budget</p>
              <p className="text-sm text-gray-700 mt-1">pour générer ton deck optimisé</p>
            </div>
          </div>
        )}

        {/* Résultats */}
        {deck && (
          <div className="p-6 overflow-y-auto h-screen">
            {/* Summary */}
            <div className="flex gap-4 mb-6 items-start">
              {cmdImg && <img src={cmdImg} alt={deck.commander.name} className="rounded-lg w-24 shadow-lg" />}
              <div>
                <h2 className="text-xl font-bold text-amber-400">{deck.commander.name}</h2>
                <p className="text-sm text-gray-400">{deck.commander.type_line}</p>
                <div className="flex gap-4 mt-2 flex-wrap">
                  <span className="text-sm"><span className="text-gray-400">Total :</span> <span className="font-semibold text-green-400">{deck.totalPrice.toFixed(2)}€</span></span>
                  <span className="text-sm"><span className="text-gray-400">Budget :</span> <span className="font-semibold">{deck.budgetUsed}%</span></span>
                  <span className="text-sm"><span className="text-gray-400">Cartes :</span> <span className="font-semibold">{deck.totalCards}/99</span></span>
                </div>
              </div>
            </div>

            {/* Cards by role */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Object.entries(deck.byRole).map(([role, cards]) => (
                <div key={role} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-200">
                      {ROLE_ICONS[role] || '•'} {role}
                    </h3>
                    <span className="text-xs text-gray-500">{cards.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {cards.map(({ card, eurPrice, count, isSynergy }) => (
                      <CardSmall key={card.id} card={card} eurPrice={eurPrice} count={count} isSynergy={isSynergy} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Export */}
            <div className="mt-6 bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-sm font-semibold text-gray-200 mb-3">📋 Export texte</h3>
              <textarea
                readOnly
                className="w-full bg-gray-800 rounded-lg p-3 text-xs text-gray-300 font-mono h-32 resize-none"
                value={[
                  `1 ${deck.commander.name}`,
                  ...deck.cards.map(({ card, count }) => `${count} ${card.name}`)
                ].join('\n')}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
