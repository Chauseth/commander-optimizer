'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';

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
  'Mana-fixing': '🌈',
  'Pioche': '📖',
  'Tuteurs': '🔍',
  'Suppression': '⚔️',
  'Contresorts': '🛡️',
  'Balayage': '🌊',
  'Protection': '🪬',
  'Finisher': '💀',
  'Synergie': '✦',
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
        className="flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-gray-800 group cursor-pointer"
        onMouseEnter={() => !isBasic && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span className="text-sm text-gray-200 group-hover:text-white truncate flex-1 min-w-0">
          {count > 1 && (
            <span className="text-amber-500 font-semibold mr-1.5">{count}×</span>
          )}
          {isSynergy && (
            <span className="text-purple-400 mr-1 text-xs" title="Synergique">✦</span>
          )}
          {card.name}
        </span>
        {isBasic ? (
          <span className="text-xs text-gray-500 shrink-0">{eurPrice.toFixed(2)}€</span>
        ) : (
          <a
            href={cardmarketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-amber-400 hover:text-amber-300 shrink-0"
            onClick={e => e.stopPropagation()}
          >
            {eurPrice > 0 ? `${eurPrice.toFixed(2)}€` : 'gratuit'}
          </a>
        )}
      </div>
      {hovered && img && (
        <div className="absolute z-50 left-full top-0 ml-2 pointer-events-none hidden md:block">
          <img src={img} alt={card.name} className="rounded-lg shadow-xl w-32" />
        </div>
      )}
    </div>
  );
}

const STEPS = [
  { key: 'commander',             label: 'Recherche du commander'      },
  { key: 'tagger',                label: 'Tags Scryfall Tagger'        },
  { key: 'pool',                  label: 'Construction du pool'         },
  { key: 'scoring',               label: 'Scoring des cartes'           },
  { key: 'dispatch',              label: 'Dispatch par slot'            },
  { key: 'Upgrade',               label: 'Optimisation budget'         },
  { key: 'Terrains non basiques', label: 'Terrains non basiques'       },
  { key: 'done',                  label: 'Finalisation'                },
];

const SLOT_CONFIG = [
  { key: 'ramp',         label: 'Rampe',         desc: 'Mana rocks & accélération',     icon: '⚡',  min: 0, max: 20 },
  { key: 'mana-fix',     label: 'Mana-fixing',   desc: 'Terrains multicolore',           icon: '🌈', min: 0, max: 8  },
  { key: 'draw',         label: 'Pioche',        desc: 'Effets de pioche',               icon: '📖', min: 0, max: 20 },
  { key: 'tutor',        label: 'Tuteurs',       desc: 'Recherche de carte',             icon: '🔍', min: 0, max: 8  },
  { key: 'spot-removal', label: 'Suppression',   desc: 'Removal ciblé',                  icon: '⚔️', min: 0, max: 15 },
  { key: 'counterspell', label: 'Contresorts',   desc: 'Counterspells (bleu requis)',    icon: '🛡️', min: 0, max: 8  },
  { key: 'board-wipe',   label: 'Balayage',      desc: 'Destructions de masse',          icon: '🌊', min: 0, max: 10 },
  { key: 'protection',   label: 'Protection',    desc: 'Hexproof, indestructible…',      icon: '🪬', min: 0, max: 6  },
  { key: 'finisher',     label: 'Finisher',      desc: 'Win-cons & gros closers',        icon: '💀', min: 0, max: 4  },
  { key: 'synergy',      label: 'Synergies',     desc: 'Cartes synergiques Commander',   icon: '✦',  min: 5, max: 50 },
] as const;

const DEFAULT_COUNTS: Record<string, number> = {
  'ramp': 10, 'mana-fix': 0, 'draw': 10, 'tutor': 0,
  'spot-removal': 7, 'counterspell': 0, 'board-wipe': 3,
  'protection': 2, 'finisher': 1, 'synergy': 26,
  totalLands: 37,
};

export default function Home() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedCommander, setSelectedCommander] = useState('');
  const [budget, setBudget] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [cardImages, setCardImages] = useState<Array<{ id: number; src: string; ejecting?: boolean }>>([]);
  const [showCards, setShowCards] = useState(false);
  const cardIdRef = useRef(0);
  const [deck, setDeck] = useState<DeckResult | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({ ...DEFAULT_COUNTS });
  const [hasModifiedCounts, setHasModifiedCounts] = useState(false);
  const [archetype, setArchetype] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
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

  useEffect(() => {
    if (!selectedCommander) { setArchetype(null); return; }
    setPreviewLoading(true);
    fetch(`/api/slot-preview?commander=${encodeURIComponent(selectedCommander)}`)
      .then(r => r.json())
      .then(data => {
        if (data.counts && !hasModifiedCounts) setCounts(data.counts);
        if (data.archetype) setArchetype(data.archetype);
      })
      .finally(() => setPreviewLoading(false));
  }, [selectedCommander]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGenerate() {
    const commander = selectedCommander || query;
    if (!commander || !budget) { setError('Remplis les deux champs.'); return; }
    setLoading(true);
    setError('');
    setDeck(null);
    setFromCache(false);
    setCurrentStep(null);
    setCompletedSteps([]);
    setCardImages([]);
    setShowCards(true);
    cardIdRef.current = 0;
    try {
      const res = await fetch('/api/generate-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commanderName: commander, budget, slotCounts: hasModifiedCounts ? counts : undefined }),
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
            flushSync(() => {
              setCurrentStep(event.step);
              setCompletedSteps(prev => {
                const idx = STEPS.findIndex(s => s.key === event.step);
                return STEPS.slice(0, idx).map(s => s.key);
              });
            });
          } else if (event.type === 'card' && event.image) {
            const id = ++cardIdRef.current;
            setCardImages(prev => [...prev, { id, src: event.image }]);
          } else if (event.type === 'upgrade' && event.newImage) {
            setCardImages(prev => {
              const idx = prev.findLastIndex(c => c.src === event.oldImage && !c.ejecting);
              const target = idx !== -1 ? idx : prev.findLastIndex(c => !c.ejecting);
              if (target === -1) return prev;
              return prev.map((c, i) => i === target ? { ...c, ejecting: true } : c);
            });
            const newId = ++cardIdRef.current;
            const newSrc = event.newImage;
            setTimeout(() => {
              setCardImages(prev => [...prev.filter(c => !c.ejecting), { id: newId, src: newSrc }]);
            }, 550);
          } else if (event.type === 'done') {
            setCompletedSteps(STEPS.map(s => s.key));
            setCurrentStep(null);
            setDeck(event.deck);
            setFromCache(!!event.fromCache);
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
    <div className="min-h-screen bg-gray-950 text-white flex flex-col md:flex-row">
      {/* Sidebar gauche : recherche + loader */}
      <aside className="w-full md:w-80 md:shrink-0 border-b md:border-b-0 md:border-r border-gray-800 flex flex-col md:h-screen md:sticky md:top-0">
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
              onChange={e => { setQuery(e.target.value); setSelectedCommander(''); setArchetype(null); }}
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
                {/* Toggle Auto / Manuel */}
                <div className="flex items-center gap-1 p-0.5 bg-gray-800 rounded-lg mb-3">
                  <button
                    type="button"
                    onClick={() => { setCounts({ ...DEFAULT_COUNTS }); setHasModifiedCounts(false); }}
                    className={`flex-1 text-xs py-1 rounded-md transition-colors font-medium ${!hasModifiedCounts ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    onClick={() => setHasModifiedCounts(true)}
                    className={`flex-1 text-xs py-1 rounded-md transition-colors font-medium ${hasModifiedCounts ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    Manuel
                  </button>
                </div>
                {!hasModifiedCounts && (
                  <div className="mb-3 text-center">
                    {previewLoading ? (
                      <span className="text-xs text-gray-500 flex items-center justify-center gap-1.5">
                        <span className="w-3 h-3 rounded-full border border-amber-500 border-t-transparent animate-spin inline-block" />
                        Analyse du Commander…
                      </span>
                    ) : archetype ? (
                      <span className="text-xs text-amber-400/80">Archétype détecté : <span className="font-semibold">{archetype}</span></span>
                    ) : (
                      <p className="text-xs text-gray-500">Répartition calculée selon l'archétype du Commander</p>
                    )}
                  </div>
                )}
                <div className={`space-y-3 ${!hasModifiedCounts ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Composition</span>
                    <span className={`text-xs font-semibold tabular-nums ${total > 99 ? 'text-red-400' : total === 99 ? 'text-green-400' : 'text-amber-400'}`}>
                      {total}/99
                    </span>
                  </div>
                  {SLOT_CONFIG.map(slot => (
                    <div key={slot.key}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-300 font-medium">{slot.icon} {slot.label}</span>
                        <span className="text-xs font-semibold text-amber-400 tabular-nums">{counts[slot.key]}</span>
                      </div>
                      <p className="text-xs text-gray-600 mb-0.5">{slot.desc}</p>
                      <input
                        type="range"
                        min={slot.min}
                        max={slot.max}
                        value={counts[slot.key]}
                        onChange={e => { setCounts(prev => ({ ...prev, [slot.key]: Number(e.target.value) })); setHasModifiedCounts(true); }}
                        className="w-full h-1 accent-amber-500 cursor-pointer"
                      />
                    </div>
                  ))}
                  <div className="pt-2 border-t border-gray-800">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-300 font-medium">🏔️ Terrains</span>
                      <span className="text-xs font-semibold text-amber-400 tabular-nums">{counts.totalLands}</span>
                    </div>
                    <p className="text-xs text-gray-600 mb-0.5">Terrains basiques + non basiques</p>
                    <input
                      type="range"
                      min={28}
                      max={45}
                      value={counts.totalLands}
                      onChange={e => { setCounts(prev => ({ ...prev, totalLands: Number(e.target.value) })); setHasModifiedCounts(true); }}
                      className="w-full h-1 accent-amber-500 cursor-pointer"
                    />
                  </div>
                </div>
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

        </div>
      </aside>

      {/* Zone centrale : animation + deck */}
      <main className="flex-1 min-h-[60vh] md:min-h-screen relative overflow-hidden">
        {/* Animation des cartes qui forment un deck */}
        {showCards && cardImages.length > 0 && !deck && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-10 pointer-events-none">
            {/* Progress au-dessus */}
            {loading && (
              <div className="flex flex-col items-center gap-3 w-72">
                <div className="flex items-center gap-2 text-sm text-white font-medium">
                  <span className="w-4 h-4 rounded-full border-2 border-amber-500 border-t-transparent animate-spin inline-block" />
                  {STEPS.find(s => s.key === currentStep)?.label ?? 'Finalisation…'}
                </div>
                <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.round((completedSteps.length / (STEPS.length - 1)) * 100)}%` }}
                  />
                </div>
                <div className="flex gap-1.5">
                  {STEPS.filter(s => s.key !== 'done').map(step => {
                    const done = completedSteps.includes(step.key);
                    const active = currentStep === step.key;
                    return (
                      <div
                        key={step.key}
                        title={step.label}
                        className={`w-2 h-2 rounded-full transition-all duration-300 ${
                          done   ? 'bg-green-500' :
                          active ? 'bg-amber-400 scale-125' :
                                   'bg-gray-700'
                        }`}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Pile de cartes */}
            <div className="relative" style={{ width: '220px', height: '308px' }}>
              {cardImages.map(({ id, src, ejecting }, index) => {
                const directions = [
                  'from-top', 'from-top-right', 'from-right', 'from-bottom-right',
                  'from-bottom', 'from-bottom-left', 'from-left', 'from-top-left'
                ];
                const direction = directions[id % directions.length];
                const stackOffset = Math.min(index, 20) * 0.5;
                const rotation = ((id % 7) - 3) * 1.5;

                return (
                  <img
                    key={id}
                    src={src}
                    alt=""
                    className={`absolute w-full rounded-xl ${ejecting ? 'card-ejecting' : `card-to-deck ${direction}`}`}
                    style={{
                      top: -stackOffset,
                      left: stackOffset,
                      transform: `rotate(${rotation}deg)`,
                      zIndex: ejecting ? 999 : index,
                    }}
                  />
                );
              })}
              {/* Compteur de cartes */}
              <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 text-center">
                <span className="text-4xl font-bold text-amber-400">{Math.min(cardImages.length, 99)}</span>
                <span className="text-gray-500 text-sm ml-1">/ 99</span>
              </div>
            </div>
          </div>
        )}

        {/* État vide */}
        {!loading && !deck && cardImages.length === 0 && (
          <div className="min-h-64 md:h-full flex items-center justify-center text-gray-600">
            <div className="text-center">
              <div className="text-6xl mb-4">🃏</div>
              <p>Choisis un Commander et un budget</p>
              <p className="text-sm text-gray-700 mt-1">pour générer ton deck optimisé</p>
            </div>
          </div>
        )}

        {/* Résultats */}
        {deck && (
          <div className="p-4 md:p-6 overflow-y-auto md:h-screen">
            {/* Summary */}
            <div className="flex gap-4 mb-6 items-start">
              {cmdImg && <img src={cmdImg} alt={deck.commander.name} className="rounded-lg w-16 md:w-24 shadow-lg" />}
              <div>
                <h2 className="text-lg md:text-xl font-bold text-amber-400">{deck.commander.name}</h2>
                <p className="text-sm text-gray-400">{deck.commander.type_line}</p>
                <div className="flex gap-4 mt-2 flex-wrap">
                  <span className="text-sm"><span className="text-gray-400">Total :</span> <span className="font-semibold text-green-400">{deck.totalPrice.toFixed(2)}€</span></span>
                  <span className="text-sm"><span className="text-gray-400">Budget :</span> <span className="font-semibold">{deck.budgetUsed}%</span></span>
                  <span className="text-sm"><span className="text-gray-400">Cartes :</span> <span className="font-semibold">{deck.totalCards}/99</span></span>
                  {fromCache && (
                    <span className="text-xs text-blue-400/70 flex items-center gap-1" title="Résultat servi depuis le cache (1h)">
                      <span>⚡</span> cache
                    </span>
                  )}
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
