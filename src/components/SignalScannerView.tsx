import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Minus,
  Radio,
  Search,
  SlidersHorizontal,
  Star,
} from 'lucide-react';
import {
  ALL_TIMEFRAMES,
  type ActiveTab,
  type AlertConditionType,
  type AlertRule,
  type BotConfig,
  type ExchangeFeed,
  type FuturesSignal,
  type MtfSignalsMap,
  type ScannerStatus,
  type Timeframe,
  type TimeframeSignalSummary,
  type TradeMode,
  type TriggeredAlertEvent,
} from '../types';
import { formatCompactVolume, formatPrice, formatRelativeTime } from '../utils/format';
import { AlertConfigPanel } from './AlertConfigPanel';
import { CandlestickChart } from './CandlestickChart';
import { RiskManagementPanel } from './RiskManagementPanel';

interface SignalScannerViewProps {
  signals: FuturesSignal[];
  mtfSignals: MtfSignalsMap;
  config: BotConfig;
  scanner: ScannerStatus;
  selectedSymbol: string | null;
  priceFlashMap: Record<string, 'up' | 'down'>;
  alertRules: AlertRule[];
  triggeredAlerts: TriggeredAlertEvent[];
  soundEnabled: boolean;
  onToggleSound: (enabled: boolean) => void;
  onCreateAlert: (input: {
    symbol: string;
    condition: AlertConditionType;
    threshold: number;
    cooldownMinutes: number;
  }) => Promise<void>;
  onToggleAlert: (id: string, enabled: boolean) => Promise<void>;
  onDeleteAlert: (id: string) => Promise<void>;
  onClearTriggeredAlerts: () => Promise<void>;
  onSelectSymbol: (symbol: string) => void;
  onTogglePriorityCoin: (symbol: string) => void;
  onChangeOtherHighProbConfidence: (score: number) => void;
  onOpenSignalDetail: (symbol: string, timeframe?: Timeframe) => void;
  onChangeTimeframe: (tf: Timeframe) => void;
  onChangeTradeMode: (mode: TradeMode) => void;
  onChangeExchange: (ex: ExchangeFeed) => void;
  onChangeInterval: (seconds: number) => void;
  onChangeMinConfidence: (minConf: number) => void;
  onToggleStrongEntryOnly: (enabled: boolean) => void;
  onToggleAutoScan: (enabled: boolean) => void;
  onNavigateTab: (tab: ActiveTab) => void;
  onTriggerScan: () => void;
}

type DirectionFilter = 'all' | 'actionable' | 'LONG' | 'SHORT';

export const SignalScannerView: React.FC<SignalScannerViewProps> = ({
  signals,
  mtfSignals,
  config,
  scanner,
  selectedSymbol,
  priceFlashMap,
  alertRules,
  triggeredAlerts,
  soundEnabled,
  onToggleSound,
  onCreateAlert,
  onToggleAlert,
  onDeleteAlert,
  onClearTriggeredAlerts,
  onSelectSymbol,
  onTogglePriorityCoin,
  onChangeOtherHighProbConfidence,
  onOpenSignalDetail,
  onChangeTimeframe,
  onChangeTradeMode,
  onChangeExchange,
  onChangeInterval,
  onChangeMinConfidence,
  onToggleStrongEntryOnly,
  onToggleAutoScan,
  onNavigateTab,
  onTriggerScan,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [dirFilter, setDirFilter] = useState<DirectionFilter>('all');
  const [topTenOnly, setTopTenOnly] = useState(false);
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [viewAllTimeframes, setViewAllTimeframes] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);

  const prioritySet = useMemo(() => new Set(config.priorityCoins ?? []), [config.priorityCoins]);

  const mtfStatsBySymbol = useMemo(() => {
    const map: Record<string, { strongCount: number; bestConf: number }> = {};
    for (const [sym, symMap] of Object.entries(mtfSignals)) {
      let strongCount = 0;
      let bestConf = 0;
      for (const tf of ALL_TIMEFRAMES) {
        const entry = symMap?.[tf];
        if (!entry) continue;
        if (entry.direction !== 'NEUTRAL' && entry.confidence >= config.minConfidence) {
          strongCount += 1;
          if (entry.confidence > bestConf) bestConf = entry.confidence;
        }
      }
      map[sym] = { strongCount, bestConf };
    }
    return map;
  }, [mtfSignals, config.minConfidence]);

  const allMtfRows = useMemo(() => {
    const rows: TimeframeSignalSummary[] = [];
    for (const symMap of Object.values(mtfSignals)) {
      for (const tf of ALL_TIMEFRAMES) {
        const entry = symMap?.[tf];
        if (entry) rows.push(entry);
      }
    }
    rows.sort((a, b) => {
      const aAct =
        a.direction !== 'NEUTRAL' && a.confidence >= config.minConfidence
          ? 2
          : a.direction !== 'NEUTRAL'
            ? 1
            : 0;
      const bAct =
        b.direction !== 'NEUTRAL' && b.confidence >= config.minConfidence
          ? 2
          : b.direction !== 'NEUTRAL'
            ? 1
            : 0;
      if (aAct !== bAct) return bAct - aAct;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      if (a.riskRewardRatio !== b.riskRewardRatio) return b.riskRewardRatio - a.riskRewardRatio;
      if (a.quoteVolume24h !== b.quoteVolume24h) return b.quoteVolume24h - a.quoteVolume24h;
      return ALL_TIMEFRAMES.indexOf(a.timeframe) - ALL_TIMEFRAMES.indexOf(b.timeframe);
    });
    return rows;
  }, [mtfSignals, config.minConfidence]);

  const rankedSignals = useMemo(() => {
    return [...signals].sort((a, b) => {
      const aMtf = mtfStatsBySymbol[a.symbol] ?? { strongCount: 0, bestConf: 0 };
      const bMtf = mtfStatsBySymbol[b.symbol] ?? { strongCount: 0, bestConf: 0 };

      const aTier =
        a.direction !== 'NEUTRAL' && a.confidence >= config.minConfidence
          ? 3
          : a.direction !== 'NEUTRAL'
            ? 2
            : aMtf.strongCount > 0
              ? 1
              : 0;
      const bTier =
        b.direction !== 'NEUTRAL' && b.confidence >= config.minConfidence
          ? 3
          : b.direction !== 'NEUTRAL'
            ? 2
            : bMtf.strongCount > 0
              ? 1
              : 0;

      if (aTier !== bTier) return bTier - aTier;

      if (aTier >= 2) {
        if (a.confidence !== b.confidence) return b.confidence - a.confidence;
        if (aMtf.strongCount !== bMtf.strongCount) return bMtf.strongCount - aMtf.strongCount;
        if (a.riskRewardRatio !== b.riskRewardRatio) return b.riskRewardRatio - a.riskRewardRatio;
        return b.quoteVolume24h - a.quoteVolume24h;
      }

      if (aTier === 1) {
        if (aMtf.bestConf !== bMtf.bestConf) return bMtf.bestConf - aMtf.bestConf;
        if (aMtf.strongCount !== bMtf.strongCount) return bMtf.strongCount - aMtf.strongCount;
        if (a.confidence !== b.confidence) return b.confidence - a.confidence;
        return b.quoteVolume24h - a.quoteVolume24h;
      }

      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      if (a.quoteVolume24h !== b.quoteVolume24h) return b.quoteVolume24h - a.quoteVolume24h;
      if (a.symbol === 'BTCUSDC') return -1;
      if (b.symbol === 'BTCUSDC') return 1;
      return 0;
    });
  }, [signals, mtfStatsBySymbol, config.minConfidence]);

  const filteredSignals = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    const list = rankedSignals.filter((s) => {
      if (priorityOnly && !prioritySet.has(s.symbol)) {
        return false;
      }
      if (q && !s.symbol.includes(q) && !s.baseAsset.includes(q)) {
        return false;
      }
      if (dirFilter === 'actionable') {
        const hasMtfStrong = (mtfStatsBySymbol[s.symbol]?.strongCount ?? 0) > 0;
        return (s.direction !== 'NEUTRAL' && s.confidence >= config.minConfidence) || hasMtfStrong;
      }
      if (dirFilter === 'LONG' || dirFilter === 'SHORT') {
        return s.direction === dirFilter;
      }
      return true;
    });
    return topTenOnly ? list.slice(0, 10) : list;
  }, [
    rankedSignals,
    mtfStatsBySymbol,
    priorityOnly,
    prioritySet,
    searchQuery,
    dirFilter,
    topTenOnly,
    config.minConfidence,
  ]);

  const filteredMtfSignals = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    const list = allMtfRows.filter((s) => {
      if (priorityOnly && !prioritySet.has(s.symbol)) {
        return false;
      }
      if (q && !s.symbol.includes(q) && !s.baseAsset.includes(q)) {
        return false;
      }
      if (dirFilter === 'actionable') {
        return s.direction !== 'NEUTRAL' && s.confidence >= config.minConfidence;
      }
      if (dirFilter === 'LONG' || dirFilter === 'SHORT') {
        return s.direction === dirFilter;
      }
      return true;
    });
    return topTenOnly ? list.slice(0, 10) : list;
  }, [allMtfRows, priorityOnly, prioritySet, searchQuery, dirFilter, topTenOnly, config.minConfidence]);

  const activeSignal = useMemo(() => {
    if (selectedSymbol) {
      const found = rankedSignals.find((s) => s.symbol === selectedSymbol);
      if (found) return found;
    }
    return filteredSignals[0] ?? rankedSignals[0] ?? null;
  }, [rankedSignals, filteredSignals, selectedSymbol]);

  const btcSignal = useMemo(
    () => signals.find((s) => s.symbol === 'BTCUSDC') ?? null,
    [signals],
  );

  const metrics = useMemo(() => {
    const actionable = signals.filter(
      (s) => s.direction !== 'NEUTRAL' && s.confidence >= config.minConfidence,
    );
    const longCount = actionable.filter((s) => s.direction === 'LONG').length;
    const shortCount = actionable.filter((s) => s.direction === 'SHORT').length;
    const mtfActionable = allMtfRows.filter(
      (s) => s.direction !== 'NEUTRAL' && s.confidence >= config.minConfidence,
    );
    const mtfLong = mtfActionable.filter((s) => s.direction === 'LONG').length;
    const mtfShort = mtfActionable.filter((s) => s.direction === 'SHORT').length;
    const avgRsi =
      signals.length > 0
        ? signals.reduce((sum, s) => sum + s.indicators.rsi14, 0) / signals.length
        : 0;

    return {
      total: signals.length,
      actionableCount: actionable.length,
      longCount,
      shortCount,
      mtfActionableCount: mtfActionable.length,
      mtfLong,
      mtfShort,
      avgRsi,
    };
  }, [signals, allMtfRows, config.minConfidence]);

  return (
    <div className="space-y-5">
      {/* 4-Column Summary Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#131A26] border border-slate-800 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-400">BTC Perpetual Anchor</div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-100">
              {btcSignal ? `$${formatPrice(btcSignal.lastPrice)}` : '--'}
            </span>
            {btcSignal && (
              <span className="text-xs font-mono tabular-nums">
                <span
                  className={
                    btcSignal.priceChange24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }
                >
                  {btcSignal.priceChange24hPct >= 0 ? '+' : ''}
                  {btcSignal.priceChange24hPct.toFixed(2)}%
                </span>
                <span className="text-slate-600 mx-1.5">·</span>
                <span
                  className={
                    btcSignal.direction === 'LONG'
                      ? 'text-emerald-400'
                      : btcSignal.direction === 'SHORT'
                        ? 'text-rose-400'
                        : 'text-slate-400'
                  }
                >
                  {btcSignal.direction}
                </span>
              </span>
            )}
          </div>
        </div>

        <div className="bg-[#131A26] border border-slate-800 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-400">
            <span>Active Setups (&ge;{config.minConfidence}%)</span>
            <span className="font-mono tabular-nums text-[11px] text-sky-400">
              All TFs: {metrics.mtfActionableCount}
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-100">
              {viewAllTimeframes ? metrics.mtfActionableCount : metrics.actionableCount}
            </span>
            <span className="text-xs font-mono tabular-nums">
              <span className="text-emerald-400">
                {viewAllTimeframes ? metrics.mtfLong : metrics.longCount} Long
              </span>
              <span className="text-slate-600 mx-1.5">·</span>
              <span className="text-rose-400">
                {viewAllTimeframes ? metrics.mtfShort : metrics.shortCount} Short
              </span>
            </span>
          </div>
        </div>

        <div className="bg-[#131A26] border border-slate-800 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-400">Market Average RSI(14)</div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-100">
              {metrics.total > 0 ? metrics.avgRsi.toFixed(1) : '--'}
            </span>
            <span className="text-xs text-slate-400">
              {metrics.avgRsi >= 60
                ? 'Bullish bias'
                : metrics.avgRsi <= 40 && metrics.avgRsi > 0
                  ? 'Oversold lean'
                  : 'Balanced'}
            </span>
          </div>
        </div>

        <div className="bg-[#131A26] border border-slate-800 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-400">Live Stream &amp; Auto-Refresh</div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-base font-semibold text-slate-100 inline-flex items-center gap-1.5">
              <Radio
                className={`w-4 h-4 ${
                  scanner.lighterStreamConnected ? 'text-emerald-400' : 'text-amber-400'
                }`}
              />
              {scanner.lighterStreamConnected ? 'Lighter WS Live' : 'Connecting...'}
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {config.autoScanEnabled ? `Scan ${config.autoScanIntervalSeconds}s` : 'Manual'}
            </span>
          </div>
        </div>
      </section>

      {/* Workspace Filter & Live Feed Toolbar */}
      <section className="bg-[#131A26] border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter pair (BTC, SOL)..."
              className="w-44 bg-[#0B0F17] border border-slate-800 rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-md">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'actionable', label: config.strongEntryOnly ? 'Strong 80%+' : 'Actionable' },
                { id: 'LONG', label: 'Long' },
                { id: 'SHORT', label: 'Short' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setDirFilter(opt.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  dirFilter === opt.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
            <span className="w-px h-4 bg-slate-800 mx-0.5" />
            <button
              type="button"
              onClick={() => setPriorityOnly((v) => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono font-semibold rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                priorityOnly
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-amber-300 hover:bg-slate-800/70'
              }`}
            >
              <Star className={`w-3 h-3 ${priorityOnly ? 'fill-slate-950' : 'fill-amber-400 text-amber-400'}`} />
              Selected ({prioritySet.size})
            </button>
            <button
              type="button"
              onClick={() => setTopTenOnly((v) => !v)}
              className={`px-2.5 py-1 text-xs font-mono font-semibold rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                topTenOnly
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-sky-300 hover:bg-slate-800/70'
              }`}
            >
              Top 1–10
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* All 6 Timeframes + Unified All-TF View Toggle */}
          <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-md">
            <button
              type="button"
              onClick={() => setViewAllTimeframes((v) => !v)}
              className={`px-2 py-1 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewAllTimeframes
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'text-sky-300 hover:text-sky-200 hover:bg-slate-800/70'
              }`}
            >
              All TFs ({scanner.mtfTimeframesReady?.length ?? 1}/6)
            </button>
            <span className="w-px h-4 bg-slate-800 mx-0.5" />
            {(
              [
                { id: '1d', label: '1D' },
                { id: '4h', label: '4H' },
                { id: '1h', label: '1H' },
                { id: '30m', label: '30m' },
                { id: '15m', label: '15m' },
                { id: '5m', label: '5m' },
              ] as Array<{ id: Timeframe; label: string }>
            ).map((tf) => (
              <button
                key={tf.id}
                type="button"
                onClick={() => {
                  setViewAllTimeframes(false);
                  onChangeTimeframe(tf.id);
                }}
                className={`px-2 py-1 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  !viewAllTimeframes && config.timeframe === tf.id
                    ? 'bg-sky-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* Trade Style Calibration Selector */}
          <select
            aria-label="Trade Style Calibration"
            value={config.tradeMode}
            onChange={(e) => onChangeTradeMode(e.target.value as TradeMode)}
            className="bg-[#0B0F17] border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            <option value="swing">Mode: Swing Trade (1.2R–3.6R)</option>
            <option value="auto">Mode: Auto by Timeframe</option>
            <option value="intraday">Mode: Intraday (1.1R–3.2R)</option>
            <option value="scalp">Mode: Scalp (1R–2.8R)</option>
          </select>

          {/* Exchange Feed Selector */}
          <select
            aria-label="Exchange Data Feed"
            value={config.exchange}
            onChange={(e) => onChangeExchange(e.target.value as ExchangeFeed)}
            className="bg-[#0B0F17] border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            <option value="lighter">Feed: Lighter.xyz (Live)</option>
            <option value="auto">Feed: Auto Multi-Exchange</option>
            <option value="binance">Feed: Binance Futures</option>
            <option value="bybit">Feed: Bybit Linear</option>
            <option value="okx">Feed: OKX Swap</option>
          </select>

          {/* Strong Entry Only Gate Toggle */}
          <button
            type="button"
            onClick={() => onToggleStrongEntryOnly(!config.strongEntryOnly)}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              config.strongEntryOnly
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                : 'bg-[#0B0F17] border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            Strong Only (80%+): {config.strongEntryOnly ? 'On' : 'Off'}
          </button>

          {/* Min Confidence Selector (Selected Coins) */}
          <select
            aria-label="Minimum Signal Score"
            value={config.minConfidence}
            onChange={(e) => onChangeMinConfidence(Number(e.target.value))}
            className="bg-[#0B0F17] border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            {!config.strongEntryOnly && (
              <>
                <option value={60}>Min Score: 60%</option>
                <option value={70}>Min Score: 70%</option>
              </>
            )}
            <option value={80}>Selected: 80%+</option>
            <option value={85}>Selected: 85%+</option>
            <option value={90}>Selected: 90%+</option>
            <option value={95}>Selected: 95%+</option>
          </select>

          {/* Other Coins High-Probability Threshold */}
          <select
            aria-label="Other Coins High-Probability Threshold"
            value={config.otherHighProbConfidence ?? 90}
            onChange={(e) => onChangeOtherHighProbConfidence(Number(e.target.value))}
            className="bg-[#0B0F17] border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            <option value={85}>Others High-Prob: 85%+</option>
            <option value={90}>Others High-Prob: 90%+</option>
            <option value={92}>Others High-Prob: 92%+</option>
            <option value={95}>Others High-Prob: 95%+</option>
          </select>

          {/* Auto-Refresh Cadence */}
          <select
            aria-label="Auto Refresh Interval"
            value={config.autoScanIntervalSeconds}
            onChange={(e) => onChangeInterval(Number(e.target.value))}
            className="bg-[#0B0F17] border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            <option value={30}>Refresh: 30s</option>
            <option value={60}>Refresh: 1m</option>
            <option value={180}>Refresh: 3m</option>
            <option value={300}>Refresh: 5m</option>
          </select>

          <button
            type="button"
            onClick={() => onToggleAutoScan(!config.autoScanEnabled)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              config.autoScanEnabled
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                : 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            Live Auto: {config.autoScanEnabled ? 'On' : 'Off'}
          </button>

          <button
            type="button"
            onClick={() => setAlertsOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              alertsOpen || alertRules.some((r) => r.enabled)
                ? 'bg-sky-500/10 border-sky-500/40 text-sky-300'
                : 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            Alerts ({alertRules.filter((r) => r.enabled).length})
          </button>
        </div>
      </section>

      {alertsOpen && (
        <AlertConfigPanel
          watchlist={config.watchlist}
          signals={signals}
          selectedSymbol={activeSignal?.symbol ?? selectedSymbol}
          alertRules={alertRules}
          triggeredAlerts={triggeredAlerts}
          soundEnabled={soundEnabled}
          onToggleSound={onToggleSound}
          onCreateAlert={onCreateAlert}
          onToggleAlert={onToggleAlert}
          onDeleteAlert={onDeleteAlert}
          onClearTriggered={onClearTriggeredAlerts}
          onClose={() => setAlertsOpen(false)}
        />
      )}

      {scanner.lastError && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-4 py-3 text-xs text-rose-300 flex items-center justify-between gap-3">
          <span>{scanner.lastError}</span>
          <button
            type="button"
            onClick={onTriggerScan}
            className="px-3 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 rounded font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            Retry Scan
          </button>
        </div>
      )}

      {/* Split Workspace: Left Signals Table, Right Selected Signal Inspector */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Signals Data Table */}
        <div className="lg:col-span-7 bg-[#131A26] border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                {viewAllTimeframes
                  ? `All Timeframes Live Signals (${filteredMtfSignals.length} setups across 1D–5m)`
                  : `BTC & Altcoin Live Signals (${config.timeframe.toUpperCase()} + Multi-TF)`}
              </h2>
              <p className="text-xs text-slate-400">
                {scanner.isScanning ? (
                  <span className="text-sky-400">
                    Scanning {config.timeframe.toUpperCase()} &amp; multi-timeframe candles...
                  </span>
                ) : (
                  <>Signals analyzed {formatRelativeTime(scanner.lastScanAt)}</>
                )}
                {scanner.lastTickAt && ` · Stream tick ${formatRelativeTime(scanner.lastTickAt)}`}
                {scanner.failedSymbols.length > 0 &&
                  ` · ${scanner.failedSymbols.length} unavailable`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('watchlist')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Edit Watchlist
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-[#0F1520]">
                  <th className="py-2.5 pl-4 pr-2 w-10 text-center">#</th>
                  <th className="py-2.5 px-2">Pair</th>
                  <th className="py-2.5 px-2 text-right">Live Price</th>
                  <th className="py-2.5 px-2">Signal</th>
                  <th className="py-2.5 px-2 text-right">Score</th>
                  <th className="py-2.5 px-2 text-right">RSI(14)</th>
                  <th className="py-2.5 px-2 text-right">Entry Zone</th>
                  <th className="py-2.5 pl-2 pr-4 text-right">SL / TP2</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {scanner.isScanning && signals.length === 0 ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="h-[46px]">
                      <td colSpan={8} className="px-4">
                        <div className="h-4 bg-slate-800/60 rounded animate-pulse w-full" />
                      </td>
                    </tr>
                  ))
                ) : (viewAllTimeframes ? filteredMtfSignals.length === 0 : filteredSignals.length === 0) ? (
                  <tr>
                    <td colSpan={8} className="py-12 px-4 text-center">
                      <p className="text-sm text-slate-300 font-medium">
                        No pairs match the current filter
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Reset your filters or trigger a live market scan.
                      </p>
                      <div className="mt-4 flex items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setDirFilter('all');
                            setTopTenOnly(false);
                            setPriorityOnly(false);
                          }}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium cursor-pointer"
                        >
                          Reset Filters
                        </button>
                        <button
                          type="button"
                          onClick={onTriggerScan}
                          className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded text-xs font-semibold cursor-pointer"
                        >
                          Scan Market
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : viewAllTimeframes ? (
                  filteredMtfSignals.map((sig, idx) => {
                    const rank = idx + 1;
                    const isTopTen = rank <= 10;
                    const isSelected =
                      activeSignal?.symbol === sig.symbol && config.timeframe === sig.timeframe;
                    const isLong = sig.direction === 'LONG';
                    const isShort = sig.direction === 'SHORT';
                    const isActionable = (isLong || isShort) && sig.confidence >= config.minConfidence;
                    const symStrongCount = mtfStatsBySymbol[sig.symbol]?.strongCount ?? 0;
                    const isImp =
                      isActionable &&
                      (sig.confidence >= 85 || symStrongCount >= 2 || isTopTen);
                    const flash = priceFlashMap[sig.symbol];

                    return (
                      <tr
                        key={`${sig.symbol}:${sig.timeframe}`}
                        onClick={() => {
                          onSelectSymbol(sig.symbol);
                          onOpenSignalDetail(sig.symbol, sig.timeframe);
                        }}
                        className={`h-[46px] transition-colors cursor-pointer ${
                          rank === 11 ? 'border-t-2 border-amber-500/30' : ''
                        } ${
                          isSelected ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'
                        }`}
                      >
                        <td className="py-2 pl-4 pr-2 text-center font-mono tabular-nums whitespace-nowrap">
                          <span
                            className={
                              isTopTen
                                ? 'text-amber-300 font-semibold'
                                : 'text-slate-500'
                            }
                          >
                            {rank}
                          </span>
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                            <button
                              type="button"
                              aria-label={
                                prioritySet.has(sig.symbol)
                                  ? `Unselect ${sig.baseAsset} priority`
                                  : `Select ${sig.baseAsset} priority`
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                onTogglePriorityCoin(sig.symbol);
                              }}
                              className="p-0.5 text-slate-500 hover:text-amber-300 cursor-pointer shrink-0"
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${
                                  prioritySet.has(sig.symbol)
                                    ? 'text-amber-400 fill-amber-400'
                                    : 'text-slate-600'
                                }`}
                              />
                            </button>
                            <span>
                              {sig.baseAsset}
                              <span className="text-slate-500 font-normal">/USDC</span>
                            </span>
                            <span className="px-1.5 py-0.5 bg-sky-500/10 border border-sky-500/30 rounded text-[10px] font-mono text-sky-300">
                              {sig.timeframe.toUpperCase()}
                            </span>
                            {isImp && (
                              <span className="px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/45 rounded text-[10px] font-mono font-bold tracking-wide text-amber-300">
                                IMP
                              </span>
                            )}
                            {!prioritySet.has(sig.symbol) && sig.isHighProbability && (
                              <span className="px-1.5 py-0.5 bg-emerald-500/15 border border-emerald-500/45 rounded text-[10px] font-mono font-bold text-emerald-300">
                                HIGH PROB
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono tabular-nums text-slate-400">
                            <span className="uppercase text-slate-500">{sig.tradeStyle}</span>
                            <span className="mx-1 text-slate-600">·</span>
                            <span
                              className={
                                sig.priceChange24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }
                            >
                              {sig.priceChange24hPct >= 0 ? '+' : ''}
                              {sig.priceChange24hPct.toFixed(2)}%
                            </span>
                          </div>
                        </td>

                        <td
                          className={`py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap transition-colors duration-200 ${
                            flash === 'up'
                              ? 'text-emerald-300'
                              : flash === 'down'
                                ? 'text-rose-300'
                                : 'text-slate-100'
                          }`}
                        >
                          <div>${formatPrice(sig.lastPrice)}</div>
                          <div className="text-[10px] text-slate-500 uppercase">
                            {sig.exchangeUsed}
                          </div>
                        </td>

                        <td className="py-2 px-2 whitespace-nowrap">
                          {isLong ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                              <ArrowUpRight className="w-3.5 h-3.5" />
                              {sig.confidence >= 80 ? 'STRONG ' : ''}LONG {sig.suggestedLeverage}x
                            </span>
                          ) : isShort ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-rose-400">
                              <ArrowDownRight className="w-3.5 h-3.5" />
                              {sig.confidence >= 80 ? 'STRONG ' : ''}SHORT {sig.suggestedLeverage}x
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-500">
                              <Minus className="w-3.5 h-3.5" />
                              NO ENTRY
                            </span>
                          )}
                        </td>

                        <td className="py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="text-slate-100">{sig.confidence}%</div>
                          <div className="w-14 ml-auto h-1 bg-slate-800 rounded-full overflow-hidden mt-1">
                            <div
                              className={`h-full ${
                                isLong
                                  ? 'bg-emerald-500'
                                  : isShort
                                    ? 'bg-rose-500'
                                    : 'bg-slate-500'
                              }`}
                              style={{ width: `${sig.confidence}%` }}
                            />
                          </div>
                        </td>

                        <td className="py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <span
                            className={
                              sig.rsi14 >= 70
                                ? 'text-amber-400'
                                : sig.rsi14 <= 30
                                  ? 'text-sky-400'
                                  : 'text-slate-300'
                            }
                          >
                            {sig.rsi14.toFixed(1)}
                          </span>
                        </td>

                        <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                          <div className="text-[11px]">${formatPrice(sig.entryMin)}</div>
                          <div className="text-[11px] text-slate-400">
                            ${formatPrice(sig.entryMax)}
                          </div>
                          {sig.inEntryZone ? (
                            <div className="text-[9px] text-emerald-400 font-semibold">IN ZONE</div>
                          ) : sig.entryZoneStatus === 'APPROACHING_ZONE' ? (
                            <div className="text-[9px] text-amber-300">NEAR OB</div>
                          ) : null}
                        </td>

                        <td className="py-2 pl-2 pr-4 text-right font-mono tabular-nums whitespace-nowrap">
                          {isLong || isShort ? (
                            <>
                              <div className="text-rose-400 text-[11px]">
                                SL ${formatPrice(sig.stopLoss)}
                              </div>
                              <div className="text-emerald-400 text-[11px]">
                                TP2 ${formatPrice(sig.tp2)}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="text-slate-400 text-[10px]">
                                Ref SL ${formatPrice(sig.stopLoss)}
                              </div>
                              <div className="text-slate-500 text-[10px]">
                                Ref TP2 ({sig.tp2 >= sig.stopLoss ? 'Long' : 'Short'}) $
                                {formatPrice(sig.tp2)}
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  filteredSignals.map((sig, idx) => {
                    const rank = idx + 1;
                    const isTopTen = rank <= 10;
                    const isSelected = activeSignal?.symbol === sig.symbol;
                    const isLong = sig.direction === 'LONG';
                    const isShort = sig.direction === 'SHORT';
                    const flash = priceFlashMap[sig.symbol];
                    const symMtf = mtfSignals[sig.symbol] ?? {};
                    const symMtfStats = mtfStatsBySymbol[sig.symbol] ?? { strongCount: 0, bestConf: 0 };
                    const isActionable = (isLong || isShort) && sig.confidence >= config.minConfidence;
                    const isImp =
                      (isActionable && (sig.confidence >= 85 || symMtfStats.strongCount >= 2 || isTopTen)) ||
                      (symMtfStats.strongCount >= 1 && symMtfStats.bestConf >= 90 && isTopTen);

                    return (
                      <tr
                        key={sig.symbol}
                        onClick={() => {
                          onSelectSymbol(sig.symbol);
                          onOpenSignalDetail(sig.symbol, sig.timeframe);
                        }}
                        className={`transition-colors cursor-pointer ${
                          rank === 11 ? 'border-t-2 border-amber-500/30' : ''
                        } ${
                          isSelected ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'
                        }`}
                      >
                        <td className="py-2.5 pl-4 pr-2 text-center font-mono tabular-nums whitespace-nowrap align-top">
                          <span
                            className={
                              isTopTen
                                ? 'text-amber-300 font-semibold'
                                : 'text-slate-500'
                            }
                          >
                            {rank}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                            <button
                              type="button"
                              aria-label={
                                prioritySet.has(sig.symbol)
                                  ? `Unselect ${sig.baseAsset} priority`
                                  : `Select ${sig.baseAsset} priority`
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                onTogglePriorityCoin(sig.symbol);
                              }}
                              className="p-0.5 text-slate-500 hover:text-amber-300 cursor-pointer shrink-0"
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${
                                  prioritySet.has(sig.symbol)
                                    ? 'text-amber-400 fill-amber-400'
                                    : 'text-slate-600'
                                }`}
                              />
                            </button>
                            <span>
                              {sig.baseAsset}
                              <span className="text-slate-500 font-normal">/USDC</span>
                            </span>
                            {isImp && (
                              <span className="px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/45 rounded text-[10px] font-mono font-bold tracking-wide text-amber-300">
                                IMP
                              </span>
                            )}
                            {!prioritySet.has(sig.symbol) && sig.isHighProbability && (
                              <span className="px-1.5 py-0.5 bg-emerald-500/15 border border-emerald-500/45 rounded text-[10px] font-mono font-bold text-emerald-300">
                                HIGH PROB
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono tabular-nums text-slate-400">
                            <span
                              className={
                                sig.priceChange24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }
                            >
                              {sig.priceChange24hPct >= 0 ? '+' : ''}
                              {sig.priceChange24hPct.toFixed(2)}%
                            </span>
                            <span className="mx-1 text-slate-600">·</span>
                            <span>{formatCompactVolume(sig.quoteVolume24h)}</span>
                          </div>
                          {/* All-Timeframes Signal Quick Strip */}
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {ALL_TIMEFRAMES.map((tf) => {
                              const tfSig = tf === sig.timeframe ? sig : symMtf[tf];
                              if (!tfSig) return null;
                              const isTfLong = tfSig.direction === 'LONG';
                              const isTfShort = tfSig.direction === 'SHORT';
                              return (
                                <button
                                  key={tf}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectSymbol(sig.symbol);
                                    onOpenSignalDetail(sig.symbol, tf);
                                  }}
                                  title={`${sig.baseAsset} ${tf.toUpperCase()} ${tfSig.direction} (${tfSig.confidence}%)`}
                                  className={`px-1 py-0.5 rounded border text-[9px] font-mono tabular-nums leading-none cursor-pointer transition-colors ${
                                    isTfLong
                                      ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/20'
                                      : isTfShort
                                        ? 'bg-rose-500/10 border-rose-500/35 text-rose-300 hover:bg-rose-500/20'
                                        : 'bg-[#0B0F17] border-slate-800 text-slate-500 hover:text-slate-300'
                                  }`}
                                >
                                  {tf.toUpperCase()}
                                  {isTfLong ? `▲${tfSig.confidence}` : isTfShort ? `▼${tfSig.confidence}` : '·'}
                                </button>
                              );
                            })}
                          </div>
                        </td>

                        <td
                          className={`py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap transition-colors duration-200 ${
                            flash === 'up'
                              ? 'text-emerald-300'
                              : flash === 'down'
                                ? 'text-rose-300'
                                : 'text-slate-100'
                          }`}
                        >
                          <div>${formatPrice(sig.lastPrice)}</div>
                          <div className="text-[10px] text-slate-500 uppercase">
                            {sig.exchangeUsed}
                          </div>
                        </td>

                        <td className="py-2 px-2 whitespace-nowrap">
                          {isLong ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                              <ArrowUpRight className="w-3.5 h-3.5" />
                              {sig.confidence >= 80 ? 'STRONG ' : ''}LONG {sig.suggestedLeverage}x
                            </span>
                          ) : isShort ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-rose-400">
                              <ArrowDownRight className="w-3.5 h-3.5" />
                              {sig.confidence >= 80 ? 'STRONG ' : ''}SHORT {sig.suggestedLeverage}x
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-500">
                              <Minus className="w-3.5 h-3.5" />
                              NO ENTRY
                            </span>
                          )}
                        </td>

                        <td className="py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="text-slate-100">{sig.confidence}%</div>
                          <div className="w-14 ml-auto h-1 bg-slate-800 rounded-full overflow-hidden mt-1">
                            <div
                              className={`h-full ${
                                isLong
                                  ? 'bg-emerald-500'
                                  : isShort
                                    ? 'bg-rose-500'
                                    : 'bg-slate-500'
                              }`}
                              style={{ width: `${sig.confidence}%` }}
                            />
                          </div>
                        </td>

                        <td className="py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <span
                            className={
                              sig.indicators.rsi14 >= 70
                                ? 'text-amber-400'
                                : sig.indicators.rsi14 <= 30
                                  ? 'text-sky-400'
                                  : 'text-slate-300'
                            }
                          >
                            {sig.indicators.rsi14.toFixed(1)}
                          </span>
                        </td>

                        <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                          <div className="text-[11px]">${formatPrice(sig.entryMin)}</div>
                          <div className="text-[11px] text-slate-400">
                            ${formatPrice(sig.entryMax)}
                          </div>
                          {sig.smc?.inEntryZone ? (
                            <div className="text-[9px] text-emerald-400 font-semibold">IN ZONE</div>
                          ) : sig.smc?.entryZoneStatus === 'APPROACHING_ZONE' ? (
                            <div className="text-[9px] text-amber-300">
                              OB {sig.smc.zoneDistancePct.toFixed(1)}%
                            </div>
                          ) : null}
                        </td>

                        <td className="py-2 pl-2 pr-4 text-right font-mono tabular-nums whitespace-nowrap">
                          {isLong || isShort ? (
                            <>
                              <div className="text-rose-400 text-[11px]">
                                SL ${formatPrice(sig.stopLoss)}
                              </div>
                              <div className="text-emerald-400 text-[11px]">
                                TP2 ${formatPrice(sig.tp2)}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="text-slate-400 text-[10px]">
                                Ref SL ${formatPrice(sig.stopLoss)}
                              </div>
                              <div className="text-slate-500 text-[10px]">
                                Ref TP2 ({sig.tp2 >= sig.stopLoss ? 'Long' : 'Short'}) $
                                {formatPrice(sig.tp2)}
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Selected Signal Inspector & Interactive Chart */}
        <div className="lg:col-span-5 lg:sticky lg:top-[68px] lg:max-h-[calc(100vh-84px)] lg:overflow-y-auto bg-[#131A26] border border-slate-800 rounded-lg p-4 space-y-4">
          {!activeSignal ? (
            <div className="py-16 text-center text-sm text-slate-400">
              Loading live perpetual futures setups...
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-100 flex flex-wrap items-center gap-2">
                    <span>{activeSignal.baseAsset}/USDC Perpetual</span>
                    <button
                      type="button"
                      onClick={() => onTogglePriorityCoin(activeSignal.symbol)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-mono cursor-pointer transition-colors ${
                        prioritySet.has(activeSignal.symbol)
                          ? 'bg-amber-500/15 border-amber-500/45 text-amber-300'
                          : 'bg-[#0B0F17] border-slate-700 text-slate-400 hover:text-amber-300'
                      }`}
                    >
                      <Star
                        className={`w-3 h-3 ${
                          prioritySet.has(activeSignal.symbol)
                            ? 'text-amber-400 fill-amber-400'
                            : 'text-slate-500'
                        }`}
                      />
                      {prioritySet.has(activeSignal.symbol) ? 'Selected' : 'Star Coin'}
                    </button>
                    {((activeSignal.direction !== 'NEUTRAL' && activeSignal.confidence >= 85) ||
                      (mtfStatsBySymbol[activeSignal.symbol]?.strongCount ?? 0) >= 2 ||
                      (mtfStatsBySymbol[activeSignal.symbol]?.bestConf ?? 0) >= 90) && (
                      <span className="px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/45 rounded text-[10px] font-mono font-bold tracking-wide text-amber-300">
                        IMP
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                    {activeSignal.timeframe.toUpperCase()} · {activeSignal.tradeStyle.toUpperCase()} ·{' '}
                    {activeSignal.exchangeUsed.toUpperCase()}
                    {activeSignal.fundingRatePct !== null &&
                      ` · Funding ${activeSignal.fundingRatePct >= 0 ? '+' : ''}${activeSignal.fundingRatePct.toFixed(4)}%`}
                    {activeSignal.openInterestUsd !== null &&
                      activeSignal.openInterestUsd > 0 &&
                      ` · OI ${formatCompactVolume(activeSignal.openInterestUsd)}`}
                  </p>
                </div>

                <div className="text-right">
                  <div
                    className={`text-sm font-semibold inline-flex items-center gap-1 ${
                      activeSignal.direction === 'LONG'
                        ? 'text-emerald-400'
                        : activeSignal.direction === 'SHORT'
                          ? 'text-rose-400'
                          : 'text-amber-300'
                    }`}
                  >
                    {activeSignal.direction === 'LONG' && <ArrowUpRight className="w-4 h-4" />}
                    {activeSignal.direction === 'SHORT' && <ArrowDownRight className="w-4 h-4" />}
                    {activeSignal.direction === 'LONG'
                      ? `${activeSignal.confidence >= 80 ? 'STRONG ' : ''}BUY / LONG`
                      : activeSignal.direction === 'SHORT'
                        ? `${activeSignal.confidence >= 80 ? 'STRONG ' : ''}SELL / SHORT`
                        : 'WAIT · NO STRONG ENTRY'}{' '}
                    · {activeSignal.confidence}%
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-400 mt-0.5">
                    {activeSignal.direction === 'NEUTRAL'
                      ? `Projected ${activeSignal.tp2 >= activeSignal.stopLoss ? 'LONG' : 'SHORT'} Ref · `
                      : ''}
                    Suggested {activeSignal.suggestedLeverage}x Cross · R:R 1:
                    {activeSignal.riskRewardRatio.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Interactive SVG Candlestick Chart (updates live on incoming ticks) */}
              <CandlestickChart signal={activeSignal} />

              {/* Live Orderbook Best Bid / Ask Strip if available from Lighter WS */}
              {activeSignal.bestBid !== null && activeSignal.bestAsk !== null && (
                <div className="grid grid-cols-3 gap-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 font-mono tabular-nums">
                  <div>
                    <span className="text-slate-400 text-[11px]">Best Bid </span>
                    <span className="text-emerald-400">${formatPrice(activeSignal.bestBid)}</span>
                  </div>
                  <div className="text-center">
                    <span className="text-slate-400 text-[11px]">Mark </span>
                    <span className="text-slate-100">${formatPrice(activeSignal.lastPrice)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 text-[11px]">Best Ask </span>
                    <span className="text-rose-400">${formatPrice(activeSignal.bestAsk)}</span>
                  </div>
                </div>
              )}

              {/* Futures Trade Execution Levels */}
              {(() => {
                const projDir: 'LONG' | 'SHORT' =
                  activeSignal.direction === 'LONG'
                    ? 'LONG'
                    : activeSignal.direction === 'SHORT'
                      ? 'SHORT'
                      : activeSignal.tp2 >= activeSignal.stopLoss
                        ? 'LONG'
                        : 'SHORT';
                const isWait = activeSignal.direction === 'NEUTRAL';
                const slPos = projDir === 'SHORT' ? 'Above' : 'Below';
                const tpPos = projDir === 'SHORT' ? 'Below' : 'Above';

                return (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                    <div
                      className={`bg-[#0B0F17] rounded-md p-2.5 border ${
                        activeSignal.direction === 'LONG'
                          ? 'border-emerald-500/40'
                          : activeSignal.direction === 'SHORT'
                            ? 'border-rose-500/40'
                            : 'border-amber-500/35'
                      }`}
                    >
                      <div
                        className={`text-[11px] font-medium ${
                          activeSignal.direction === 'LONG'
                            ? 'text-emerald-400'
                            : activeSignal.direction === 'SHORT'
                              ? 'text-rose-400'
                              : 'text-amber-300'
                        }`}
                      >
                        {activeSignal.direction === 'LONG'
                          ? 'LONG Entry (Buy)'
                          : activeSignal.direction === 'SHORT'
                            ? 'SHORT Entry (Sell)'
                            : `Wait (${projDir} Ref Zone)`}
                      </div>
                      <div className="font-mono tabular-nums font-medium text-slate-100 mt-1">
                        ${formatPrice(activeSignal.entryMin)} – ${formatPrice(activeSignal.entryMax)}
                      </div>
                      {activeSignal.smc && (
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                          {activeSignal.smc.zoneLabel}
                        </div>
                      )}
                    </div>

                    <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                      <div className="text-slate-400 text-[11px]">
                        {isWait ? `Ref Stop Loss (${slPos})` : `Stop Loss (${slPos})`}
                      </div>
                      <div className="font-mono tabular-nums font-medium text-rose-400 mt-1">
                        ${formatPrice(activeSignal.stopLoss)} (-{activeSignal.stopLossPct.toFixed(2)}%)
                      </div>
                    </div>

                    <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                      <div className="text-slate-400 text-[11px]">ATR(14) Volatility</div>
                      <div className="font-mono tabular-nums font-medium text-slate-200 mt-1">
                        ${formatPrice(activeSignal.indicators.atr14)} (
                        {activeSignal.indicators.atrPct.toFixed(2)}%)
                      </div>
                    </div>

                    <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                      <div className="text-slate-400 text-[11px]">
                        {isWait ? `Ref TP1 (${tpPos})` : `Take Profit 1 (${tpPos})`}
                      </div>
                      <div className="font-mono tabular-nums font-medium text-emerald-400 mt-1">
                        ${formatPrice(activeSignal.tp1)} (+{activeSignal.tp1Pct.toFixed(2)}%)
                      </div>
                    </div>

                    <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                      <div className="text-slate-400 text-[11px]">
                        {isWait ? `Ref TP2 (${tpPos})` : `Take Profit 2 (${tpPos})`}
                      </div>
                      <div className="font-mono tabular-nums font-medium text-emerald-400 mt-1">
                        ${formatPrice(activeSignal.tp2)} (+{activeSignal.tp2Pct.toFixed(2)}%)
                      </div>
                    </div>

                    <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                      <div className="text-slate-400 text-[11px]">
                        {isWait ? `Ref TP3 (${tpPos})` : `Take Profit 3 (${tpPos})`}
                      </div>
                      <div className="font-mono tabular-nums font-medium text-emerald-400 mt-1">
                        ${formatPrice(activeSignal.tp3)} (+{activeSignal.tp3Pct.toFixed(2)}%)
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Smart Money Liquidity & Order Block Summary */}
              {activeSignal.smc && (
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono tabular-nums bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                  <div>
                    <span className="text-slate-400 font-sans">Zone Gate: </span>
                    <span
                      className={
                        activeSignal.smc.inEntryZone
                          ? 'text-emerald-400 font-semibold'
                          : activeSignal.smc.entryZoneStatus === 'APPROACHING_ZONE'
                            ? 'text-amber-300 font-semibold'
                            : 'text-slate-300'
                      }
                    >
                      {activeSignal.smc.inEntryZone
                        ? 'PERFECT ZONE'
                        : `${activeSignal.smc.zoneDistancePct.toFixed(2)}% TO OB`}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 font-sans">Liquidity: </span>
                    <span
                      className={
                        activeSignal.smc.liquiditySweep === 'SSL_SWEEP'
                          ? 'text-emerald-400'
                          : activeSignal.smc.liquiditySweep === 'BSL_SWEEP'
                            ? 'text-rose-400'
                            : 'text-slate-300'
                      }
                    >
                      {activeSignal.smc.liquiditySweep === 'NONE'
                        ? activeSignal.smc.bosDirection.replace('_BOS', ' BOS')
                        : activeSignal.smc.liquiditySweep.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              )}

              {/* All Timeframes (1D – 5m) Quick Matrix for Active Coin */}
              <div className="bg-[#0B0F17] border border-slate-800 rounded-md overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-200">
                    All Timeframes ({activeSignal.baseAsset}/USDC)
                  </span>
                  <span className="text-[11px] text-slate-400">Click TF to open entry/exit</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 p-2 text-[11px] font-mono tabular-nums">
                  {ALL_TIMEFRAMES.map((tf) => {
                    const tfSig =
                      tf === activeSignal.timeframe
                        ? activeSignal
                        : mtfSignals[activeSignal.symbol]?.[tf];
                    const isTfLong = tfSig?.direction === 'LONG';
                    const isTfShort = tfSig?.direction === 'SHORT';
                    return (
                      <button
                        key={tf}
                        type="button"
                        onClick={() => onOpenSignalDetail(activeSignal.symbol, tf)}
                        className={`p-2 rounded border text-left transition-colors cursor-pointer ${
                          isTfLong
                            ? 'bg-emerald-500/10 border-emerald-500/35 hover:border-emerald-400'
                            : isTfShort
                              ? 'bg-rose-500/10 border-rose-500/35 hover:border-rose-400'
                              : 'bg-[#131A26] border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-100">{tf.toUpperCase()}</span>
                          <span
                            className={
                              isTfLong
                                ? 'text-emerald-400 font-semibold'
                                : isTfShort
                                  ? 'text-rose-400 font-semibold'
                                  : 'text-slate-400'
                            }
                          >
                            {tfSig ? `${tfSig.direction} ${tfSig.confidence}%` : 'Syncing'}
                          </span>
                        </div>
                        {tfSig && (
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                            Entry ${formatPrice(tfSig.entryMin)} · SL ${formatPrice(tfSig.stopLoss)}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Technical Confluence Breakdown */}
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-200">Technical Confluence</span>
                  <span className="font-mono tabular-nums text-slate-400">
                    Vol {activeSignal.indicators.volumeRatio.toFixed(2)}x · BB %B{' '}
                    {(activeSignal.indicators.bbPercentB * 100).toFixed(0)}%
                  </span>
                </div>
                <ul className="space-y-1.5 text-xs text-slate-300">
                  {activeSignal.reasons.map((reason, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-sky-400 mt-0.5">•</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <RiskManagementPanel signal={activeSignal} />
            </>
          )}
        </div>
      </section>
    </div>
  );
};
