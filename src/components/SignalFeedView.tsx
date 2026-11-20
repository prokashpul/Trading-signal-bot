import React, { useId, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Trash2 } from 'lucide-react';
import {
  ALL_TIMEFRAMES,
  type ActiveTab,
  type ActiveTrackedTrade,
  type FuturesSignal,
  type MtfSignalsMap,
  type SignalFeedEntry,
  type Timeframe,
} from '../types';
import { formatCandleTime, formatDateTime, formatPrice } from '../utils/format';
import { LiveTradesPnlView } from './LiveTradesPnlView';

interface PricePoint {
  t: number;
  p: number;
}

interface MiniPriceTrendChartProps {
  points: PricePoint[];
  timeframe: Timeframe;
}

const MiniPriceTrendChart: React.FC<MiniPriceTrendChartProps> = ({ points, timeframe }) => {
  const uid = useId().replace(/:/g, '');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const chart = useMemo(() => {
    if (points.length < 2) return null;
    const width = 160;
    const height = 34;
    const padY = 3;

    const prices = points.map((pt) => pt.p);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min || max * 0.002 || 1;

    const coords = points.map((pt, idx) => {
      const x = (idx / (points.length - 1)) * width;
      const y = padY + ((max - pt.p) / span) * (height - padY * 2);
      return { x, y, t: pt.t, p: pt.p };
    });

    const first = points[0];
    const last = points[points.length - 1];
    const changePct = first.p > 0 ? ((last.p - first.p) / first.p) * 100 : 0;
    const isUp = last.p >= first.p;

    const linePath = coords
      .map((c, idx) => `${idx === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(' ');
    const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

    return {
      width,
      height,
      coords,
      linePath,
      areaPath,
      baseY: coords[0].y,
      first,
      last,
      changePct,
      isUp,
    };
  }, [points]);

  if (!chart) {
    return (
      <div className="w-full lg:w-44 shrink-0 text-[11px] font-mono text-slate-500 flex items-center justify-center h-12 border border-slate-800/70 rounded bg-[#0B0F17]/60">
        No trend data
      </div>
    );
  }

  const activePoint =
    hoverIdx !== null && chart.coords[hoverIdx] ? chart.coords[hoverIdx] : null;
  const strokeColor = chart.isUp ? '#34D399' : '#FB7185';

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * (chart.coords.length - 1));
    setHoverIdx(idx);
  };

  return (
    <div className="w-full lg:w-48 shrink-0 bg-[#0B0F17]/75 border border-slate-800/80 rounded-md px-2.5 py-1.5">
      <div className="flex items-center justify-between text-[10px] font-mono tabular-nums mb-0.5">
        <span className="text-slate-400">
          {activePoint
            ? formatCandleTime(activePoint.t, timeframe)
            : `${points.length}×${timeframe.toUpperCase()}`}
        </span>
        <span className={chart.isUp ? 'text-emerald-400' : 'text-rose-400'}>
          {activePoint
            ? `$${formatPrice(activePoint.p)}`
            : `${chart.changePct >= 0 ? '+' : ''}${chart.changePct.toFixed(2)}%`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        className="w-full h-8 overflow-visible block"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={`feedGrad-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.28" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        <line
          x1={0}
          y1={chart.baseY}
          x2={chart.width}
          y2={chart.baseY}
          stroke="#334155"
          strokeWidth="0.75"
          strokeDasharray="2 2"
        />

        <path d={chart.areaPath} fill={`url(#feedGrad-${uid})`} />
        <path
          d={chart.linePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {activePoint ? (
          <>
            <line
              x1={activePoint.x}
              y1={0}
              x2={activePoint.x}
              y2={chart.height}
              stroke="#64748B"
              strokeWidth="0.8"
              strokeDasharray="2 2"
            />
            <circle cx={activePoint.x} cy={activePoint.y} r="2.6" fill={strokeColor} />
          </>
        ) : (
          <circle
            cx={chart.coords[chart.coords.length - 1].x}
            cy={chart.coords[chart.coords.length - 1].y}
            r="2.2"
            fill={strokeColor}
          />
        )}
      </svg>

      <div className="flex items-center justify-between text-[9px] font-mono tabular-nums text-slate-500 mt-0.5">
        <span>{formatCandleTime(chart.first.t, timeframe)}</span>
        <span>{formatCandleTime(chart.last.t, timeframe)}</span>
      </div>
    </div>
  );
};

interface SignalFeedViewProps {
  feed: SignalFeedEntry[];
  signals?: FuturesSignal[];
  mtfSignals?: MtfSignalsMap;
  activeTrades?: ActiveTrackedTrade[];
  priceFlashMap?: Record<string, 'up' | 'down'>;
  onClearFeed: () => Promise<void>;
  onCloseTrackedTrade: (symbol: string, timeframe?: Timeframe) => Promise<void>;
  onInspectSignal: (symbol: string, entry?: SignalFeedEntry) => void;
  onInspectSymbol: (symbol: string, timeframe?: Timeframe) => void;
  onNavigateTab: (tab: ActiveTab) => void;
}

export const SignalFeedView: React.FC<SignalFeedViewProps> = ({
  feed,
  signals = [],
  mtfSignals = {},
  activeTrades = [],
  priceFlashMap = {},
  onClearFeed,
  onCloseTrackedTrade,
  onInspectSignal,
  onInspectSymbol,
  onNavigateTab,
}) => {
  const [tfFilter, setTfFilter] = useState<'all' | Timeframe>('all');

  const liveSignalMap = useMemo(
    () => new Map(signals.map((sig) => [sig.symbol, sig])),
    [signals],
  );

  const filteredFeed = useMemo(
    () => (tfFilter === 'all' ? feed : feed.filter((item) => item.timeframe === tfFilter)),
    [feed, tfFilter],
  );

  return (
    <div className="space-y-5">
      <LiveTradesPnlView
        compact
        activeTrades={activeTrades}
        signals={signals}
        mtfSignals={mtfSignals}
        priceFlashMap={priceFlashMap}
        onInspectSymbol={onInspectSymbol}
        onCloseTrackedTrade={onCloseTrackedTrade}
        onNavigateTab={onNavigateTab}
      />

      <div className="bg-[#131A26] border border-slate-800 rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Live Signal Feed (All Timeframes)</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Chronological log of actionable LONG and SHORT futures setups across 1D, 4H, 1H, 30m, 15m, and 5m.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-md">
            <button
              type="button"
              onClick={() => setTfFilter('all')}
              className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors cursor-pointer ${
                tfFilter === 'all'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({feed.length})
            </button>
            {ALL_TIMEFRAMES.map((tf) => {
              const count = feed.filter((f) => f.timeframe === tf).length;
              return (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTfFilter(tf)}
                  className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors cursor-pointer ${
                    tfFilter === tf
                      ? 'bg-sky-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tf.toUpperCase()} ({count})
                </button>
              );
            })}
          </div>

          {feed.length > 0 && (
            <button
              type="button"
              onClick={onClearFeed}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0B0F17] border border-slate-800 hover:border-slate-700 text-slate-300 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Feed
            </button>
          )}
        </div>
      </div>

      {filteredFeed.length === 0 ? (
        <div className="py-16 px-4 text-center">
          <p className="text-sm font-medium text-slate-200">
            {feed.length === 0
              ? 'No new setups logged in this session yet'
              : `No ${tfFilter.toUpperCase()} setups logged in feed yet`}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Whenever a tracked coin meets your minimum score threshold on any timeframe, it is automatically recorded here.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            {tfFilter !== 'all' && (
              <button
                type="button"
                onClick={() => setTfFilter('all')}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-xs font-semibold cursor-pointer"
              >
                Show All Timeframes
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigateTab('scanner')}
              className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-md text-xs font-semibold cursor-pointer"
            >
              Open Live Signals
            </button>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-slate-800/80">
          {filteredFeed.map((item) => {
            const isLong = item.direction === 'LONG';
            const liveSig = liveSignalMap.get(item.symbol);
            const trendPoints: PricePoint[] =
              item.priceHistory && item.priceHistory.length >= 2
                ? item.priceHistory
                : liveSig && liveSig.chartCandles.length >= 2
                  ? liveSig.chartCandles.slice(-28).map((c) => ({ t: c.timestamp, p: c.close }))
                  : [];

            return (
              <div
                key={item.id}
                onClick={() => onInspectSignal(item.symbol, item)}
                className="p-4 hover:bg-slate-800/25 transition-colors cursor-pointer flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5 text-xs">
                    <span
                      className={`inline-flex items-center gap-1 font-semibold ${
                        isLong ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {isLong ? (
                        <ArrowUpRight className="w-4 h-4" />
                      ) : (
                        <ArrowDownRight className="w-4 h-4" />
                      )}
                      {item.baseAsset}/USDC {item.direction}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="font-mono tabular-nums text-slate-300">
                      {item.timeframe.toUpperCase()} · {item.tradeStyle.toUpperCase()} ·{' '}
                      {item.suggestedLeverage}x Cross
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="font-mono tabular-nums text-sky-400">
                      Score {item.confidence}%
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="font-mono tabular-nums text-slate-400">
                      {formatDateTime(item.timestamp)} · {item.exchangeUsed.toUpperCase()}
                    </span>
                  </div>

                  {item.reasons.length > 0 && (
                    <div className="text-xs text-slate-400 truncate">
                      {item.reasons.slice(0, 2).join(' · ')}
                    </div>
                  )}
                </div>

                <MiniPriceTrendChart points={trendPoints} timeframe={item.timeframe} />

                <div className="grid grid-cols-4 gap-4 text-xs font-mono tabular-nums shrink-0">
                  <div>
                    <div className="text-[11px] text-slate-500">Entry</div>
                    <div className="text-slate-100">${formatPrice(item.entryPrice)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Stop Loss</div>
                    <div className="text-rose-400">${formatPrice(item.stopLoss)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">TP1</div>
                    <div className="text-emerald-400">${formatPrice(item.tp1)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">TP2 (1:{item.riskRewardRatio})</div>
                    <div className="text-emerald-400">${formatPrice(item.tp2)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
};
