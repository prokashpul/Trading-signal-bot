import React, { useEffect, useState } from 'react';
import { Plus, RefreshCw, Star, Trash2, X } from 'lucide-react';
import type { BotConfig } from '../types';

interface WatchlistViewProps {
  config: BotConfig;
  isSaving: boolean;
  onSaveWatchlist: (
    watchlist: string[],
    scanAfter: boolean,
    priorityCoins?: string[],
    otherHighProbConfidence?: number,
  ) => Promise<void>;
}

const SECTOR_PRESETS: Array<{ name: string; description: string; symbols: string[] }> = [
  {
    name: 'Top Crypto Perps (BTC + 50 Alts)',
    description: 'Bitcoin plus top 50 high-liquidity altcoin perpetual futures on Lighter.xyz',
    symbols: [
      'BTCUSDC', 'ETHUSDC', 'SOLUSDC', 'XRPUSDC', 'BNBUSDC',
      'DOGEUSDC', 'ADAUSDC', 'TRXUSDC', 'AVAXUSDC', 'LINKUSDC',
      'SUIUSDC', 'HYPEUSDC', 'NEARUSDC', 'LTCUSDC', 'BCHUSDC',
      'UNIUSDC', 'AAVEUSDC', 'PEPEUSDC', 'SHIBUSDC', 'DOTUSDC',
      'APTUSDC', 'ARBUSDC', 'OPUSDC', 'TAOUSDC', 'ICPUSDC',
      'POLUSDC', 'XLMUSDC', 'HBARUSDC', 'FILUSDC', 'ENAUSDC',
      'ONDOUSDC', 'WLDUSDC', 'TIAUSDC', 'SEIUSDC', 'JUPUSDC',
      'BONKUSDC', 'FLOKIUSDC', 'WIFUSDC', 'PENDLEUSDC', 'CRVUSDC',
      'LDOUSDC', 'ZROUSDC', 'STRKUSDC', 'EIGENUSDC', 'PYTHUSDC',
      'ETHFIUSDC', 'ZKUSDC', 'DYDXUSDC', 'XMRUSDC', 'ZECUSDC',
      'LITUSDC',
    ],
  },
  {
    name: 'BTC + Layer 1 & Layer 2',
    description: 'Bitcoin, smart contract chains, and scaling rollups',
    symbols: ['BTCUSDC', 'ETHUSDC', 'SOLUSDC', 'SUIUSDC', 'AVAXUSDC', 'NEARUSDC', 'APTUSDC', 'ARBUSDC', 'OPUSDC', 'SEIUSDC', 'TIAUSDC'],
  },
  {
    name: 'AI & Compute',
    description: 'Decentralized compute, GPU networks, and AI tokens',
    symbols: ['BTCUSDC', 'FETUSDC', 'RENDERUSDC', 'TAOUSDC', 'NEARUSDC', 'WLDUSDC', 'ARKMUSDC', 'GRTUSDC'],
  },
  {
    name: 'DeFi & Infra',
    description: 'Oracles, DEXs, lending, and staking protocols',
    symbols: ['BTCUSDC', 'LINKUSDC', 'AAVEUSDC', 'UNIUSDC', 'INJUSDC', 'ENAUSDC', 'LDOUSDC', 'PENDLEUSDC', 'JUPUSDC', 'LITUSDC'],
  },
];

export const WatchlistView: React.FC<WatchlistViewProps> = ({
  config,
  isSaving,
  onSaveWatchlist,
}) => {
  const [draftList, setDraftList] = useState<string[]>(config.watchlist);
  const [draftPriority, setDraftPriority] = useState<string[]>(config.priorityCoins ?? []);
  const [draftHighProb, setDraftHighProb] = useState<number>(config.otherHighProbConfidence ?? 90);
  const [symbolInput, setSymbolInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  useEffect(() => {
    setDraftList(config.watchlist);
    setDraftPriority(config.priorityCoins ?? []);
    setDraftHighProb(config.otherHighProbConfidence ?? 90);
  }, [config.watchlist, config.priorityCoins, config.otherHighProbConfidence]);

  const handleAddSymbol = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = symbolInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleaned || cleaned.length < 2) {
      setInputError('Enter a valid ticker symbol like BTC, SOL, or LITUSDC.');
      return;
    }
    const normalized = cleaned.endsWith('USDC')
      ? cleaned
      : cleaned.endsWith('USDT')
        ? `${cleaned.slice(0, -4)}USDC`
        : `${cleaned}USDC`;
    if (draftList.includes(normalized)) {
      if (!draftPriority.includes(normalized)) {
        setDraftPriority((prev) => [...prev, normalized]);
        setSymbolInput('');
        setInputError(null);
        return;
      }
      setInputError(`${normalized} is already in your Selected Priority & Watchlist.`);
      return;
    }
    setDraftList((prev) => [...prev, normalized]);
    setDraftPriority((prev) => [...prev, normalized]);
    setSymbolInput('');
    setInputError(null);
  };

  const handleRemove = (sym: string) => {
    if (draftList.length <= 1) {
      setInputError('Keep at least 1 symbol in the watchlist.');
      return;
    }
    setDraftList((prev) => prev.filter((s) => s !== sym));
    setDraftPriority((prev) => prev.filter((s) => s !== sym));
    setInputError(null);
  };

  const togglePriority = (sym: string) => {
    setDraftPriority((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym],
    );
  };

  const handleApplyPreset = (symbols: string[]) => {
    setDraftList(symbols);
    setInputError(null);
  };

  const priorityChanged =
    draftPriority.length !== (config.priorityCoins ?? []).length ||
    draftPriority.some((s, i) => s !== (config.priorityCoins ?? [])[i]);

  const hasChanges =
    draftList.length !== config.watchlist.length ||
    draftList.some((s, i) => s !== config.watchlist[i]) ||
    priorityChanged ||
    draftHighProb !== (config.otherHighProbConfidence ?? 90);

  const prioritySet = new Set(draftPriority);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <div className="lg:col-span-8 space-y-5">
        {/* Selected Signal Coins (Priority List) Card */}
        <div className="bg-[#131A26] border border-amber-500/30 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                Selected Signal Coins (Priority List)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Starred coins receive signals at your normal Strong threshold ({config.minConfidence}%+ in Perfect Zone). All other pairs only signal when they reach High-Probability (&ge;{draftHighProb}%).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                aria-label="Other Coins High-Probability Threshold"
                value={draftHighProb}
                onChange={(e) => setDraftHighProb(Number(e.target.value))}
                className="bg-[#0B0F17] border border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                <option value={85}>Others: High-Prob &ge; 85%</option>
                <option value={90}>Others: High-Prob &ge; 90%</option>
                <option value={92}>Others: High-Prob &ge; 92%</option>
                <option value={95}>Others: High-Prob &ge; 95%</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-mono tabular-nums text-amber-300 font-medium">
              {draftPriority.length} coins selected for direct signals
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setDraftPriority(['BTCUSDC', 'ETHUSDC', 'SOLUSDC', 'ARBUSDC', 'SUIUSDC', 'LITUSDC'])
                }
                className="px-2.5 py-1 bg-[#0B0F17] border border-slate-800 hover:border-slate-700 text-slate-300 rounded text-[11px] cursor-pointer"
              >
                Select Top 6
              </button>
              <button
                type="button"
                onClick={() => setDraftPriority([])}
                className="px-2.5 py-1 bg-[#0B0F17] border border-slate-800 hover:border-rose-500/40 text-slate-400 hover:text-rose-300 rounded text-[11px] cursor-pointer"
              >
                Clear Selected (High-Prob Only)
              </button>
            </div>
          </div>

          {draftPriority.length === 0 ? (
            <div className="py-4 px-3 bg-[#0B0F17] border border-slate-800 rounded-md text-xs text-slate-400 text-center">
              No priority coins selected — currently ONLY High-Probability (&ge;{draftHighProb}%) setups from any coin will trigger signals. Click ★ on any coin below to select it.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {draftPriority.map((sym) => {
                const base = sym.replace(/(USDC|USDT)$/, '');
                return (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => togglePriority(sym)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/10 border border-amber-500/35 hover:border-rose-500/40 rounded text-xs font-mono text-amber-200 transition-colors cursor-pointer"
                    title="Click to remove from Selected Signal Coins"
                  >
                    <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                    <span>{base}/USDC</span>
                    <X className="w-3 h-3 text-amber-300/70" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Full Tracked Universe Card */}
        <div className="bg-[#131A26] border border-slate-800 rounded-lg p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Tracked Perpetual Pairs (Click ★ to Select / Unselect)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                All pairs below are scanned in background. Click ★ to toggle whether a coin is in your Selected List.
              </p>
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-300">
              {draftList.length} pairs tracked
            </div>
          </div>

          <form onSubmit={handleAddSymbol} className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={symbolInput}
              onChange={(e) => {
                setSymbolInput(e.target.value);
                if (inputError) setInputError(null);
              }}
              placeholder="Add & select coin (e.g. BTC, TAO, WIF, HYPE, LIT)..."
              className="flex-1 min-w-[220px] bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add &amp; Select
            </button>
          </form>

          {inputError && <p className="text-xs text-rose-400">{inputError}</p>}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {draftList.map((sym) => {
              const base = sym.replace(/(USDC|USDT)$/, '');
              const isSelected = prioritySet.has(sym);
              return (
                <div
                  key={sym}
                  className={`flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-md border text-xs transition-colors ${
                    isSelected
                      ? 'bg-amber-500/10 border-amber-500/40'
                      : 'bg-[#0B0F17] border-slate-800'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => togglePriority(sym)}
                    title={isSelected ? 'Remove from Selected Signal Coins' : 'Add to Selected Signal Coins'}
                    className="inline-flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <Star
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isSelected
                          ? 'text-amber-400 fill-amber-400'
                          : 'text-slate-600 hover:text-amber-300'
                      }`}
                    />
                    <span className="font-mono font-medium text-slate-200 truncate">
                      {base}
                      <span className="text-slate-500">/USDC</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${sym}`}
                    onClick={() => handleRemove(sym)}
                    className="text-slate-500 hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-400">
              {hasChanges ? 'Unsaved changes to Watchlist / Selected List' : 'Synced with live scanner'}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={isSaving || !hasChanges}
                onClick={() =>
                  onSaveWatchlist(draftList, false, draftPriority, draftHighProb)
                }
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
              >
                Save Selection
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() =>
                  onSaveWatchlist(draftList, true, draftPriority, draftHighProb)
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
                Save &amp; Scan Now
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="lg:col-span-4 bg-[#131A26] border border-slate-800 rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Quick Sector Baskets</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Load a curated BTC &amp; altcoin basket with one click.
          </p>
        </div>

        <div className="space-y-3">
          {SECTOR_PRESETS.map((preset) => (
            <div
              key={preset.name}
              className="p-3.5 bg-[#0B0F17] border border-slate-800 rounded-md space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-100">{preset.name}</span>
                <span className="text-[11px] font-mono tabular-nums text-slate-400">
                  {preset.symbols.length} pairs
                </span>
              </div>
              <p className="text-xs text-slate-400">{preset.description}</p>
              <button
                type="button"
                onClick={() => handleApplyPreset(preset.symbols)}
                className="text-xs font-medium text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
              >
                Load Basket
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
