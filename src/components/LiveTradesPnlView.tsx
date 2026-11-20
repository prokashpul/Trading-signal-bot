import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  ExternalLink,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import {
  ALL_TIMEFRAMES,
  type ActiveTab,
  type ActiveTrackedTrade,
  type FuturesSignal,
  type MtfSignalsMap,
  type Timeframe,
} from '../types';
import { formatPrice, formatRelativeTime } from '../utils/format';

interface LiveTradesPnlViewProps {
  activeTrades: ActiveTrackedTrade[];
  signals: FuturesSignal[];
  mtfSignals: MtfSignalsMap;
  priceFlashMap: Record<string, 'up' | 'down'>;
  onInspectSymbol: (symbol: string, timeframe?: Timeframe) => void;
  onCloseTrackedTrade: (symbol: string, timeframe?: Timeframe) => Promise<void>;
  onNavigateTab?: (tab: ActiveTab) => void;
  compact?: boolean;
}

type TradeSideFilter = 'all' | 'winning' | 'losing' | 'LONG' | 'SHORT';
type TradeSortKey = 'pnl_desc' | 'pnl_asc' | 'conf_desc' | 'newest';

const MARGIN_PRESETS = [100, 250, 500, 1000, 2500] as const;

interface ComputedTradeRow {
  trade: ActiveTrackedTrade;
  livePrice: number;
  leverage: number;
  rawPnlPct: number;
  roePct: number;
  pnlUsd: number;
  distanceToTp1Pct: number;
  bufferToSlPct: number;
  corridorPct: number;
  exchangeUsed: string;
}

export const LiveTradesPnlView: React.FC<LiveTradesPnlViewProps> = ({
  activeTrades,
  signals,
  mtfSignals,
  priceFlashMap,
  onInspectSymbol,
  onCloseTrackedTrade,
  onNavigateTab,
  compact = false,
}) => {
  const [marginPerTrade, setMarginPerTrade] = useState<number>(500);
  const [tfFilter, setTfFilter] = useState<'all' | Timeframe>('all');
  const [sideFilter, setSideFilter] = useState<TradeSideFilter>('all');
  const [sortBy, setSortBy] = useState<TradeSortKey>('pnl_desc');
  const [closingKey, setClosingKey] = useState<string | null>(null);

  const signalBySymbol = useMemo(
    () => new Map(signals.map((sig) => [sig.symbol, sig])),
    [signals],
  );

  const computedRows = useMemo<ComputedTradeRow[]>(() => {
    return activeTrades.map((trade) => {
      const mtfMatch = mtfSignals[trade.symbol]?.[trade.timeframe];
      const primaryMatch = signalBySymbol.get(trade.symbol);

      const livePrice =
        primaryMatch?.lastPrice ?? mtfMatch?.lastPrice ?? trade.entryPrice;
      const leverage =
        mtfMatch?.suggestedLeverage ?? primaryMatch?.suggestedLeverage ?? 5;
      const exchangeUsed =
        mtfMatch?.exchangeUsed ?? primaryMatch?.exchangeUsed ?? 'lighter';

      const isLong = trade.direction === 'LONG';
      const rawPnlPct =
        trade.entryPrice > 0
          ? ((isLong ? livePrice - trade.entryPrice : trade.entryPrice - livePrice) /
              trade.entryPrice) *
            100
          : 0;
      const roePct = rawPnlPct * leverage;
      const pnlUsd = marginPerTrade * (roePct / 100);

      const distanceToTp1Pct =
        livePrice > 0
          ? Math.max(
              0,
              ((isLong ? trade.tp1 - livePrice : livePrice - trade.tp1) / livePrice) *
                100,
            )
          : 0;

      const bufferToSlPct =
        livePrice > 0
          ? Math.max(
              0,
              ((isLong ? livePrice - trade.stopLoss : trade.stopLoss - livePrice) /
                livePrice) *
                100,
            )
          : 0;

      // Normalized bar progress from Stop Loss (0%) -> Entry (35%) -> TP1 (100%)
      let corridorPct = 35;
      if (isLong) {
        if (livePrice >= trade.entryPrice) {
          const tpSpan = Math.max(trade.tp1 - trade.entryPrice, trade.entryPrice * 0.0005);
          corridorPct = 35 + Math.min(1, Math.max(0, (livePrice - trade.entryPrice) / tpSpan)) * 65;
        } else {
          const slSpan = Math.max(trade.entryPrice - trade.stopLoss, trade.entryPrice * 0.0005);
          corridorPct = 35 - Math.min(1, Math.max(0, (trade.entryPrice - livePrice) / slSpan)) * 35;
        }
      } else {
        if (livePrice <= trade.entryPrice) {
          const tpSpan = Math.max(trade.entryPrice - trade.tp1, trade.entryPrice * 0.0005);
          corridorPct = 35 + Math.min(1, Math.max(0, (trade.entryPrice - livePrice) / tpSpan)) * 65;
        } else {
          const slSpan = Math.max(trade.stopLoss - trade.entryPrice, trade.entryPrice * 0.0005);
          corridorPct = 35 - Math.min(1, Math.max(0, (livePrice - trade.entryPrice) / slSpan)) * 35;
        }
      }

      return {
        trade,
        livePrice,
        leverage,
        rawPnlPct,
        roePct,
        pnlUsd,
        distanceToTp1Pct,
        bufferToSlPct,
        corridorPct: Math.min(100, Math.max(0, corridorPct)),
        exchangeUsed,
      };
    });
  }, [activeTrades, signalBySymbol, mtfSignals, marginPerTrade]);

  const portfolio = useMemo(() => {
    const total = computedRows.length;
    const longs = computedRows.filter((r) => r.trade.direction === 'LONG').length;
    const shorts = total - longs;
    const winning = computedRows.filter((r) => r.rawPnlPct > 0).length;
    const losing = computedRows.filter((r) => r.rawPnlPct < 0).length;
    const totalUsd = computedRows.reduce((sum, r) => sum + r.pnlUsd, 0);
    const totalMargin = total * marginPerTrade;
    const totalRoePct = totalMargin > 0 ? (totalUsd / totalMargin) * 100 : 0;
    const avgRawPnlPct =
      total > 0
        ? computedRows.reduce((sum, r) => sum + r.rawPnlPct, 0) / total
        : 0;
    const winRatioPct = total > 0 ? (winning / total) * 100 : 0;

    let best: ComputedTradeRow | null = null;
    for (const row of computedRows) {
      if (!best || row.rawPnlPct > best.rawPnlPct) {
        best = row;
      }
    }

    return {
      total,
      longs,
      shorts,
      winning,
      losing,
      totalUsd,
      totalMargin,
      totalRoePct,
      avgRawPnlPct,
      winRatioPct,
      best,
    };
  }, [computedRows, marginPerTrade]);

  const filteredRows = useMemo(() => {
    const list = computedRows.filter((row) => {
      if (tfFilter !== 'all' && row.trade.timeframe !== tfFilter) return false;
      if (sideFilter === 'winning' && row.rawPnlPct <= 0) return false;
      if (sideFilter === 'losing' && row.rawPnlPct >= 0) return false;
      if ((sideFilter === 'LONG' || sideFilter === 'SHORT') && row.trade.direction !== sideFilter) {
        return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'pnl_desc') return b.rawPnlPct - a.rawPnlPct;
      if (sortBy === 'pnl_asc') return a.rawPnlPct - b.rawPnlPct;
      if (sortBy === 'conf_desc') return b.trade.confidence - a.trade.confidence;
      return new Date(b.trade.openedAt).getTime() - new Date(a.trade.openedAt).getTime();
    });
  }, [computedRows, tfFilter, sideFilter, sortBy]);

  const displayedRows = compact ? filteredRows.slice(0, 8) : filteredRows;

  const handleCloseClick = async (
    e: React.MouseEvent,
    symbol: string,
    timeframe: Timeframe,
  ) => {
    e.stopPropagation();
    const key = `${symbol}:${timeframe}`;
    setClosingKey(key);
    try {
      await onCloseTrackedTrade(symbol, timeframe);
    } finally {
      setClosingKey((curr) => (curr === key ? null : curr));
    }
  };

  return (
    <div className="space-y-5">
      {/* 4-Card Portfolio Live PnL Summary (Full Dashboard Mode) */}
      {!compact && (
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-[#131A26] border border-slate-800 rounded-lg p-4">
            <div className="text-xs font-medium text-slate-400">Open Tracked Trades</div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-semibold font-mono tabular-nums text-slate-100">
                {portfolio.total}
              </span>
              <span className="text-xs font-mono tabular-nums">
                <span className="text-emerald-400">{portfolio.longs} Long</span>
                <span className="text-slate-600 mx-1.5">·</span>
                <span className="text-rose-400">{portfolio.shorts} Short</span>
              </span>
            </div>
          </div>

          <div className="bg-[#131A26] border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Unrealized Live PnL (USDC)</span>
              <span className="font-mono tabular-nums text-[11px] text-slate-500">
                Margin ${portfolio.totalMargin.toLocaleString()}
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <span
                className={`text-2xl font-semibold font-mono tabular-nums ${
                  portfolio.totalUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {portfolio.totalUsd >= 0 ? '+' : '-'}${Math.abs(portfolio.totalUsd).toFixed(2)}
              </span>
              <span
                className={`text-xs font-mono tabular-nums ${
                  portfolio.totalRoePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {portfolio.totalRoePct >= 0 ? '+' : ''}
                {portfolio.totalRoePct.toFixed(2)}% ROE
              </span>
            </div>
          </div>

          <div className="bg-[#131A26] border border-slate-800 rounded-lg p-4">
            <div className="text-xs font-medium text-slate-400">In Profit vs Drawdown</div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-semibold font-mono tabular-nums text-slate-100">
                {portfolio.total > 0 ? `${portfolio.winRatioPct.toFixed(0)}%` : '--'}
              </span>
              <span className="text-xs font-mono tabular-nums">
                <span className="text-emerald-400">{portfolio.winning} Win</span>
                <span className="text-slate-600 mx-1.5">·</span>
                <span className="text-rose-400">{portfolio.losing} Loss</span>
              </span>
            </div>
          </div>

          <div className="bg-[#131A26] border border-slate-800 rounded-lg p-4">
            <div className="text-xs font-medium text-slate-400">Best Live Position</div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              {portfolio.best ? (
                <>
                  <span className="text-lg font-semibold font-mono tabular-nums text-slate-100 truncate">
                    {portfolio.best.trade.baseAsset}/USDC{' '}
                    <span className="text-xs text-sky-400">
                      {portfolio.best.trade.timeframe.toUpperCase()}
                    </span>
                  </span>
                  <span
                    className={`text-sm font-semibold font-mono tabular-nums shrink-0 ${
                      portfolio.best.rawPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {portfolio.best.rawPnlPct >= 0 ? '+' : ''}
                    {portfolio.best.rawPnlPct.toFixed(2)}%
                  </span>
                </>
              ) : (
                <span className="text-sm text-slate-500">No open positions</span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Open Trades Live PnL Card */}
      <section className="bg-[#131A26] border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                Open Tracked Futures — Live PnL
              </h2>
              <span className="font-mono tabular-nums text-xs text-slate-400">
                {portfolio.total} active
              </span>
              {portfolio.total > 0 && (
                <span
                  className={`font-mono tabular-nums text-xs font-semibold ${
                    portfolio.totalUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  Net {portfolio.totalUsd >= 0 ? '+' : '-'}$
                  {Math.abs(portfolio.totalUsd).toFixed(2)} USDC (
                  {portfolio.avgRawPnlPct >= 0 ? '+' : ''}
                  {portfolio.avgRawPnlPct.toFixed(2)}% avg)
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Real-time mark-to-market profit &amp; loss updated live from WebSocket and market scans.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Simulated Margin per Position */}
            <div className="flex items-center gap-1.5 bg-[#0B0F17] border border-slate-800 rounded-md px-2 py-1 text-[11px]">
              <span className="text-slate-400">Margin/Trade:</span>
              {MARGIN_PRESETS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setMarginPerTrade(amt)}
                  className={`px-1.5 py-0.5 rounded font-mono tabular-nums cursor-pointer transition-colors ${
                    marginPerTrade === amt
                      ? 'bg-sky-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ${amt}
                </button>
              ))}
            </div>

            {compact && onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('positions')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0B0F17] border border-slate-800 hover:border-sky-500/50 text-sky-300 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Full PnL View ({portfolio.total})
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Filter & Sort Controls (shown when trades exist) */}
        {activeTrades.length > 0 && (
          <div className="px-5 py-2.5 bg-[#0F1520] border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1 p-0.5 bg-[#0B0F17] border border-slate-800 rounded-md">
                {(
                  [
                    { id: 'all', label: `All (${portfolio.total})` },
                    { id: 'winning', label: `Profit (${portfolio.winning})` },
                    { id: 'losing', label: `Loss (${portfolio.losing})` },
                    { id: 'LONG', label: `Long (${portfolio.longs})` },
                    { id: 'SHORT', label: `Short (${portfolio.shorts})` },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSideFilter(opt.id)}
                    className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                      sideFilter === opt.id
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 p-0.5 bg-[#0B0F17] border border-slate-800 rounded-md">
                <button
                  type="button"
                  onClick={() => setTfFilter('all')}
                  className={`px-2 py-1 text-[11px] font-mono rounded cursor-pointer ${
                    tfFilter === 'all'
                      ? 'bg-sky-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All TFs
                </button>
                {ALL_TIMEFRAMES.map((tf) => {
                  const cnt = activeTrades.filter((t) => t.timeframe === tf).length;
                  if (cnt === 0) return null;
                  return (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => setTfFilter(tf)}
                      className={`px-2 py-1 text-[11px] font-mono rounded cursor-pointer ${
                        tfFilter === tf
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tf.toUpperCase()} ({cnt})
                    </button>
                  );
                })}
              </div>
            </div>

            <select
              aria-label="Sort live trades"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as TradeSortKey)}
              className="bg-[#0B0F17] border border-slate-800 rounded-md px-2.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
            >
              <option value="pnl_desc">Sort: Highest Live PnL</option>
              <option value="pnl_asc">Sort: Lowest Live PnL</option>
              <option value="conf_desc">Sort: Score %</option>
              <option value="newest">Sort: Most Recent</option>
            </select>
          </div>
        )}

        {activeTrades.length === 0 ? (
          <div className="py-10 px-4 text-center space-y-2">
            <p className="text-sm font-medium text-slate-200">
              No open tracked futures positions right now
            </p>
            <p className="text-xs text-slate-400">
              Whenever the scanner detects a Strong Entry (80–100%), it opens a tracked setup here and tracks its live PnL until TP1, Stop Loss, or Close.
            </p>
            {onNavigateTab && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => onNavigateTab('scanner')}
                  className="px-4 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-md text-xs font-semibold cursor-pointer"
                >
                  View Live Scanner
                </button>
              </div>
            )}
          </div>
        ) : displayedRows.length === 0 ? (
          <div className="py-8 px-4 text-center text-xs text-slate-400">
            No open trades match the selected filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-[#0F1520]">
                  <th className="py-2.5 pl-4 pr-2">Pair / TF</th>
                  <th className="py-2.5 px-2">Side / Lev</th>
                  <th className="py-2.5 px-2 text-right">Entry &rarr; Mark</th>
                  <th className="py-2.5 px-3 min-w-[140px]">SL &harr; TP1 Progress</th>
                  <th className="py-2.5 px-2 text-right">Move / ROE</th>
                  <th className="py-2.5 px-2 text-right">Live PnL (USDC)</th>
                  <th className="py-2.5 px-2 text-right">SL / TP1</th>
                  <th className="py-2.5 pl-2 pr-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {displayedRows.map((row) => {
                  const { trade, livePrice, leverage, rawPnlPct, roePct, pnlUsd } = row;
                  const isLong = trade.direction === 'LONG';
                  const inProfit = rawPnlPct >= 0;
                  const flash = priceFlashMap[trade.symbol];
                  const rowKey = `${trade.symbol}:${trade.timeframe}`;
                  const isImp = trade.confidence >= 85;

                  return (
                    <tr
                      key={rowKey}
                      onClick={() => onInspectSymbol(trade.symbol, trade.timeframe)}
                      className="hover:bg-slate-800/30 transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 pl-4 pr-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                          <span>
                            {trade.baseAsset}
                            <span className="text-slate-500 font-normal">/USDC</span>
                          </span>
                          <span className="px-1.5 py-0.5 bg-sky-500/10 border border-sky-500/30 rounded text-[10px] font-mono text-sky-300">
                            {trade.timeframe.toUpperCase()}
                          </span>
                          {isImp && (
                            <span className="px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/45 rounded text-[10px] font-mono font-bold text-amber-300">
                              IMP
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-400">
                          {trade.confidence}% · {formatRelativeTime(trade.openedAt)} ·{' '}
                          <span className="uppercase">{row.exchangeUsed}</span>
                        </div>
                      </td>

                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <div
                          className={`inline-flex items-center gap-1 font-semibold ${
                            isLong ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {isLong ? (
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          ) : (
                            <ArrowDownRight className="w-3.5 h-3.5" />
                          )}
                          {isLong ? 'BUY' : 'SELL'} {leverage}x
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 uppercase">
                          {trade.tradeStyle}
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                        <div
                          className={`transition-colors duration-200 font-medium ${
                            flash === 'up'
                              ? 'text-emerald-300'
                              : flash === 'down'
                                ? 'text-rose-300'
                                : 'text-slate-100'
                          }`}
                        >
                          ${formatPrice(livePrice)}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Entry ${formatPrice(trade.entryPrice)}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-400 mb-1">
                          <span className="text-rose-400">-{row.bufferToSlPct.toFixed(1)}% SL</span>
                          <span className="text-emerald-400">+{row.distanceToTp1Pct.toFixed(1)}% TP1</span>
                        </div>
                        <div className="relative h-1.5 w-full bg-[#0B0F17] border border-slate-800 rounded-full overflow-hidden">
                          {/* Entry anchor at 35% */}
                          <div
                            className="absolute top-0 bottom-0 w-px bg-slate-400/70 z-10"
                            style={{ left: '35%' }}
                          />
                          <div
                            className={`h-full transition-all duration-300 ${
                              inProfit ? 'bg-emerald-500' : 'bg-rose-500'
                            }`}
                            style={{ width: `${row.corridorPct}%` }}
                          />
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                        <div
                          className={`font-semibold ${
                            inProfit ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {rawPnlPct >= 0 ? '+' : ''}
                          {rawPnlPct.toFixed(2)}%
                        </div>
                        <div
                          className={`text-[11px] ${
                            roePct >= 0 ? 'text-emerald-300/80' : 'text-rose-300/80'
                          }`}
                        >
                          {roePct >= 0 ? '+' : ''}
                          {roePct.toFixed(1)}% ROE
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            pnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {pnlUsd >= 0 ? '+' : '-'}${Math.abs(pnlUsd).toFixed(2)}
                        </span>
                        <div className="text-[10px] text-slate-500">
                          ${marginPerTrade} margin
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="text-rose-400 text-[11px]">
                          SL ${formatPrice(trade.stopLoss)}
                        </div>
                        <div className="text-emerald-400 text-[11px]">
                          TP1 ${formatPrice(trade.tp1)}
                        </div>
                      </td>

                      <td className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          disabled={closingKey === rowKey}
                          onClick={(e) => handleCloseClick(e, trade.symbol, trade.timeframe)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#0B0F17] border border-slate-800 hover:border-amber-500/50 text-amber-300 rounded text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <XCircle className="w-3 h-3" />
                          {closingKey === rowKey ? 'Closing' : 'Close'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {compact && filteredRows.length > 8 && onNavigateTab && (
          <div className="px-5 py-2.5 border-t border-slate-800 bg-[#0F1520] flex items-center justify-between text-xs">
            <span className="text-slate-400">
              Showing top 8 of {filteredRows.length} open tracked positions
            </span>
            <button
              type="button"
              onClick={() => onNavigateTab('positions')}
              className="text-sky-400 hover:text-sky-300 font-medium cursor-pointer"
            >
              View all {filteredRows.length} positions &rarr;
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
