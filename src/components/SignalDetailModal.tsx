import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus, X } from 'lucide-react';
import {
  ALL_TIMEFRAMES,
  type FuturesSignal,
  type SignalFeedEntry,
  type Timeframe,
  type TimeframeSignalSummary,
} from '../types';
import { formatCompactVolume, formatDateTime, formatPrice } from '../utils/format';
import { CandlestickChart } from './CandlestickChart';
import { RiskManagementPanel } from './RiskManagementPanel';

interface SignalDetailModalProps {
  symbol: string;
  initialTimeframe?: Timeframe;
  primarySignal: FuturesSignal | null;
  mtfMap?: Partial<Record<Timeframe, TimeframeSignalSummary>>;
  feedEntry?: SignalFeedEntry | null;
  onClose: () => void;
  onOpenInScanner?: (symbol: string) => void;
}

export const SignalDetailModal: React.FC<SignalDetailModalProps> = ({
  symbol,
  initialTimeframe,
  primarySignal,
  mtfMap = {},
  feedEntry = null,
  onClose,
  onOpenInScanner,
}) => {
  const defaultTf: Timeframe =
    initialTimeframe ?? primarySignal?.timeframe ?? feedEntry?.timeframe ?? '4h';

  const [activeTf, setActiveTf] = useState<Timeframe>(defaultTf);
  const [fetchedSignals, setFetchedSignals] = useState<Partial<Record<Timeframe, FuturesSignal>>>({});
  const [loadingTf, setLoadingTf] = useState<Timeframe | null>(null);

  useEffect(() => {
    setActiveTf(initialTimeframe ?? primarySignal?.timeframe ?? feedEntry?.timeframe ?? '4h');
    setFetchedSignals({});
  }, [symbol, initialTimeframe, primarySignal?.timeframe, feedEntry?.timeframe]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (primarySignal && primarySignal.timeframe === activeTf) return;
    if (fetchedSignals[activeTf]) return;

    let cancelled = false;
    setLoadingTf(activeTf);

    fetch(`/api/signal?symbol=${encodeURIComponent(symbol)}&timeframe=${activeTf}`)
      .then((res) => res.json())
      .then((data: { ok?: boolean; signal?: FuturesSignal }) => {
        if (cancelled) return;
        if (data.ok && data.signal) {
          setFetchedSignals((prev) => ({ ...prev, [activeTf]: data.signal! }));
        }
      })
      .catch(() => {
        // Summary fallback still renders cleanly
      })
      .finally(() => {
        if (!cancelled) setLoadingTf((curr) => (curr === activeTf ? null : curr));
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, activeTf, primarySignal, fetchedSignals]);

  const activeFullSignal: FuturesSignal | null = useMemo(() => {
    if (primarySignal && primarySignal.timeframe === activeTf) {
      // Merge live tick price if available
      return primarySignal;
    }
    const fetched = fetchedSignals[activeTf];
    if (!fetched) return null;
    if (primarySignal && primarySignal.lastPrice > 0) {
      return {
        ...fetched,
        lastPrice: primarySignal.lastPrice,
        priceChange24hPct: primarySignal.priceChange24hPct,
        quoteVolume24h: primarySignal.quoteVolume24h,
        bestBid: primarySignal.bestBid ?? fetched.bestBid,
        bestAsk: primarySignal.bestAsk ?? fetched.bestAsk,
      };
    }
    return fetched;
  }, [primarySignal, fetchedSignals, activeTf]);

  const activeSummary: TimeframeSignalSummary | null = mtfMap[activeTf] ?? null;
  const activeFeedFallback =
    feedEntry && feedEntry.timeframe === activeTf ? feedEntry : null;

  if (!primarySignal && !activeSummary && !feedEntry && Object.keys(mtfMap).length === 0) {
    return null;
  }

  const baseAsset =
    activeFullSignal?.baseAsset ??
    activeSummary?.baseAsset ??
    primarySignal?.baseAsset ??
    feedEntry?.baseAsset ??
    symbol.replace(/(USDC|USDT)$/, '');

  const direction =
    activeFullSignal?.direction ??
    activeSummary?.direction ??
    activeFeedFallback?.direction ??
    primarySignal?.direction ??
    'NEUTRAL';
  const confidence =
    activeFullSignal?.confidence ??
    activeSummary?.confidence ??
    activeFeedFallback?.confidence ??
    primarySignal?.confidence ??
    50;
  const tradeStyle =
    activeFullSignal?.tradeStyle ??
    activeSummary?.tradeStyle ??
    activeFeedFallback?.tradeStyle ??
    primarySignal?.tradeStyle ??
    'swing';
  const exchangeUsed =
    activeFullSignal?.exchangeUsed ??
    activeSummary?.exchangeUsed ??
    activeFeedFallback?.exchangeUsed ??
    primarySignal?.exchangeUsed ??
    'lighter';
  const suggestedLeverage =
    activeFullSignal?.suggestedLeverage ??
    activeSummary?.suggestedLeverage ??
    activeFeedFallback?.suggestedLeverage ??
    primarySignal?.suggestedLeverage ??
    3;
  const riskRewardRatio =
    activeFullSignal?.riskRewardRatio ??
    activeSummary?.riskRewardRatio ??
    activeFeedFallback?.riskRewardRatio ??
    primarySignal?.riskRewardRatio ??
    2;

  const isLong = direction === 'LONG';
  const isShort = direction === 'SHORT';

  const lastPrice =
    primarySignal?.lastPrice ??
    activeFullSignal?.lastPrice ??
    activeSummary?.lastPrice ??
    feedEntry?.entryPrice ??
    0;

  const entryMin = activeFullSignal?.entryMin ?? activeSummary?.entryMin;
  const entryMax = activeFullSignal?.entryMax ?? activeSummary?.entryMax;
  const entryLabel =
    entryMin !== undefined && entryMax !== undefined
      ? `$${formatPrice(entryMin)} – $${formatPrice(entryMax)}`
      : `$${formatPrice(activeFeedFallback?.entryPrice ?? feedEntry?.entryPrice ?? lastPrice)}`;

  const stopLoss =
    activeFullSignal?.stopLoss ??
    activeSummary?.stopLoss ??
    activeFeedFallback?.stopLoss ??
    feedEntry?.stopLoss ??
    lastPrice;
  const tp1 =
    activeFullSignal?.tp1 ??
    activeSummary?.tp1 ??
    activeFeedFallback?.tp1 ??
    feedEntry?.tp1 ??
    lastPrice;
  const tp2 =
    activeFullSignal?.tp2 ??
    activeSummary?.tp2 ??
    activeFeedFallback?.tp2 ??
    feedEntry?.tp2 ??
    lastPrice;
  const tp3 =
    activeFullSignal?.tp3 ??
    activeSummary?.tp3 ??
    activeFeedFallback?.tp3 ??
    feedEntry?.tp3 ??
    lastPrice;

  const calcPct = (target: number) =>
    lastPrice > 0 ? Math.abs(((target - lastPrice) / lastPrice) * 100) : 0;

  const stopLossPct = activeFullSignal?.stopLossPct ?? activeSummary?.stopLossPct ?? calcPct(stopLoss);
  const tp1Pct = activeFullSignal?.tp1Pct ?? activeSummary?.tp1Pct ?? calcPct(tp1);
  const tp2Pct = activeFullSignal?.tp2Pct ?? activeSummary?.tp2Pct ?? calcPct(tp2);
  const tp3Pct = activeFullSignal?.tp3Pct ?? activeSummary?.tp3Pct ?? calcPct(tp3);

  const reasons =
    activeFullSignal?.reasons ??
    activeSummary?.reasons ??
    activeFeedFallback?.reasons ??
    feedEntry?.reasons ??
    [];

  const rsi14 = activeFullSignal?.indicators.rsi14 ?? activeSummary?.rsi14;
  const atrPct = activeFullSignal?.indicators.atrPct ?? activeSummary?.atrPct;
  const volumeRatio = activeFullSignal?.indicators.volumeRatio ?? activeSummary?.volumeRatio;
  const swingLow = activeFullSignal?.indicators.swingLow ?? activeSummary?.swingLow;
  const swingHigh = activeFullSignal?.indicators.swingHigh ?? activeSummary?.swingHigh;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${baseAsset}/USDC Signal Information`}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="bg-[#131A26] border border-slate-800 rounded-lg w-full max-w-5xl max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="sticky top-0 z-10 bg-[#0F1520] px-5 py-3.5 border-b border-slate-800 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-base font-semibold text-slate-100">
                  {baseAsset}/USDC Perpetual
                </h2>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold ${
                    isLong ? 'text-emerald-400' : isShort ? 'text-rose-400' : 'text-slate-400'
                  }`}
                >
                  {isLong && <ArrowUpRight className="w-4 h-4" />}
                  {isShort && <ArrowDownRight className="w-4 h-4" />}
                  {!isLong && !isShort && <Minus className="w-3.5 h-3.5" />}
                  {isLong
                    ? `${confidence >= 80 ? 'STRONG ' : ''}BUY / LONG`
                    : isShort
                      ? `${confidence >= 80 ? 'STRONG ' : ''}SELL / SHORT`
                      : 'NO STRONG ENTRY (WAIT)'}{' '}
                  · {confidence}%
                </span>
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  {activeTf.toUpperCase()} · {tradeStyle.toUpperCase()} · {exchangeUsed.toUpperCase()}
                </span>
              </div>

              <div className="text-xs font-mono tabular-nums text-slate-400 flex flex-wrap items-center gap-3">
                <span className="text-slate-100 font-medium">
                  Live Price: ${formatPrice(lastPrice)}
                </span>
                {(primarySignal || activeFullSignal) && (
                  <>
                    <span
                      className={
                        (primarySignal?.priceChange24hPct ?? activeFullSignal?.priceChange24hPct ?? 0) >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }
                    >
                      24h:{' '}
                      {(primarySignal?.priceChange24hPct ?? activeFullSignal?.priceChange24hPct ?? 0) >= 0
                        ? '+'
                        : ''}
                      {(primarySignal?.priceChange24hPct ?? activeFullSignal?.priceChange24hPct ?? 0).toFixed(2)}%
                    </span>
                    <span>
                      24h Vol:{' '}
                      {formatCompactVolume(
                        primarySignal?.quoteVolume24h ?? activeFullSignal?.quoteVolume24h ?? 0,
                      )}
                    </span>
                    {(primarySignal?.fundingRatePct ?? activeFullSignal?.fundingRatePct) !== null &&
                      (primarySignal?.fundingRatePct ?? activeFullSignal?.fundingRatePct) !== undefined && (
                        <span>
                          Funding:{' '}
                          {(primarySignal?.fundingRatePct ?? activeFullSignal?.fundingRatePct ?? 0) >= 0
                            ? '+'
                            : ''}
                          {(primarySignal?.fundingRatePct ?? activeFullSignal?.fundingRatePct ?? 0).toFixed(4)}%
                        </span>
                      )}
                  </>
                )}
                {feedEntry && <span>Logged: {formatDateTime(feedEntry.timestamp)}</span>}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onOpenInScanner && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenInScanner(symbol);
                    onClose();
                  }}
                  className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                >
                  Focus in Scanner
                </button>
              )}
              <button
                type="button"
                aria-label="Close signal details"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* All 6 Timeframes Switcher Strip */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] font-medium text-slate-400 mr-1">Timeframes:</span>
            {ALL_TIMEFRAMES.map((tf) => {
              const tfInfo =
                (primarySignal?.timeframe === tf ? primarySignal : null) ??
                fetchedSignals[tf] ??
                mtfMap[tf];
              const isTfSelected = activeTf === tf;
              const tfDir = tfInfo?.direction;
              const tfConf = tfInfo?.confidence;

              return (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setActiveTf(tf)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-mono tabular-nums transition-colors cursor-pointer ${
                    isTfSelected
                      ? 'bg-sky-500/15 border-sky-500 text-slate-100 font-semibold'
                      : 'bg-[#0B0F17] border-slate-800 hover:border-slate-700 text-slate-300'
                  }`}
                >
                  <span>{tf.toUpperCase()}</span>
                  {tfDir ? (
                    <span
                      className={
                        tfDir === 'LONG'
                          ? 'text-emerald-400'
                          : tfDir === 'SHORT'
                            ? 'text-rose-400'
                            : 'text-slate-400'
                      }
                    >
                      {tfDir === 'LONG' ? '▲' : tfDir === 'SHORT' ? '▼' : '–'} {tfConf}%
                    </span>
                  ) : (
                    <span className="text-slate-500">Load</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Prominent Entry & Exit Trade Levels for Selected Timeframe */}
          {(() => {
            const projectedDir: 'LONG' | 'SHORT' = isLong
              ? 'LONG'
              : isShort
                ? 'SHORT'
                : tp1 >= stopLoss
                  ? 'LONG'
                  : 'SHORT';
            const isWait = !isLong && !isShort;
            const slPosHint = projectedDir === 'SHORT' ? 'Above Entry' : 'Below Entry';
            const tpPosHint = projectedDir === 'SHORT' ? 'Below Entry' : 'Above Entry';

            return (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-100">
                      {activeTf.toUpperCase()} Entry &amp; Exit Plan ({suggestedLeverage}x Cross · R:R 1:
                      {riskRewardRatio.toFixed(2)})
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold ${
                        isLong
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : isShort
                            ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                            : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                      }`}
                    >
                      {isLong
                        ? 'ACTION: BUY / LONG'
                        : isShort
                          ? 'ACTION: SELL / SHORT'
                          : `WAIT · PROJECTED ${projectedDir} REF`}
                    </span>
                  </div>
                  {primarySignal?.bestBid !== null &&
                    primarySignal?.bestBid !== undefined &&
                    primarySignal?.bestAsk !== null &&
                    primarySignal?.bestAsk !== undefined && (
                      <span className="font-mono tabular-nums text-[11px] text-slate-400">
                        Bid <span className="text-emerald-400">${formatPrice(primarySignal.bestBid)}</span> ·
                        Ask <span className="text-rose-400">${formatPrice(primarySignal.bestAsk)}</span>
                      </span>
                    )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 text-xs font-mono tabular-nums">
                  <div
                    className={`bg-[#0B0F17] rounded-md p-3 border ${
                      isLong
                        ? 'border-emerald-500/45'
                        : isShort
                          ? 'border-rose-500/45'
                          : 'border-amber-500/35'
                    }`}
                  >
                    <div
                      className={`text-[11px] font-sans font-semibold ${
                        isLong
                          ? 'text-emerald-400'
                          : isShort
                            ? 'text-rose-400'
                            : 'text-amber-300'
                      }`}
                    >
                      {isLong
                        ? 'LONG Entry (Buy)'
                        : isShort
                          ? 'SHORT Entry (Sell)'
                          : `Wait (${projectedDir} Ref Zone)`}
                    </div>
                    <div className="text-slate-100 font-semibold mt-1">{entryLabel}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {isWait
                        ? `${projectedDir === 'SHORT' ? 'Bearish bias · do not enter yet' : 'Bullish bias · do not enter yet'}`
                        : `${suggestedLeverage}x Cross Leverage`}
                    </div>
                  </div>

                  <div className="bg-[#0B0F17] border border-rose-500/35 rounded-md p-3">
                    <div className="text-[11px] text-rose-400 font-sans font-medium">
                      {isWait ? `Ref Stop Loss (${projectedDir})` : 'Exit: Stop Loss'}
                    </div>
                    <div className="text-rose-400 font-semibold mt-1">${formatPrice(stopLoss)}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      -{stopLossPct.toFixed(2)}% Risk · {slPosHint}
                    </div>
                  </div>

                  <div className="bg-[#0B0F17] border border-emerald-500/35 rounded-md p-3">
                    <div className="text-[11px] text-emerald-400 font-sans font-medium">
                      {isWait ? `Ref TP1 (${projectedDir})` : 'Exit: TP1 Target'}
                    </div>
                    <div className="text-emerald-400 font-semibold mt-1">${formatPrice(tp1)}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      +{tp1Pct.toFixed(2)}% · {tpPosHint}
                    </div>
                  </div>

                  <div className="bg-[#0B0F17] border border-emerald-500/35 rounded-md p-3">
                    <div className="text-[11px] text-emerald-400 font-sans font-medium">
                      {isWait ? `Ref TP2 (${projectedDir})` : 'Exit: TP2 Target'}
                    </div>
                    <div className="text-emerald-400 font-semibold mt-1">${formatPrice(tp2)}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      +{tp2Pct.toFixed(2)}% (1:{riskRewardRatio})
                    </div>
                  </div>

                  <div className="bg-[#0B0F17] border border-emerald-500/35 rounded-md p-3">
                    <div className="text-[11px] text-emerald-300 font-sans font-medium">
                      {isWait ? `Ref TP3 (${projectedDir})` : 'Exit: TP3 Runner'}
                    </div>
                    <div className="text-emerald-300 font-semibold mt-1">${formatPrice(tp3)}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      +{tp3Pct.toFixed(2)}% Max Target
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Live Chart for Active Timeframe */}
          {activeFullSignal ? (
            <CandlestickChart signal={activeFullSignal} />
          ) : loadingTf === activeTf ? (
            <div className="h-52 bg-[#0B0F17] border border-slate-800 rounded-md flex items-center justify-center text-xs text-slate-400">
              Loading {activeTf.toUpperCase()} candles &amp; chart...
            </div>
          ) : null}

          {/* Institutional Liquidity & Order Block Analysis */}
          {activeFullSignal?.smc && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs font-mono tabular-nums">
              <div
                className={`bg-[#0B0F17] rounded-md p-2.5 border ${
                  activeFullSignal.smc.inEntryZone
                    ? 'border-emerald-500/40'
                    : activeFullSignal.smc.entryZoneStatus === 'APPROACHING_ZONE'
                      ? 'border-amber-500/35'
                      : 'border-slate-800'
                }`}
              >
                <div className="text-[11px] text-slate-400 font-sans">Entry Zone Gate</div>
                <div
                  className={`font-semibold mt-0.5 ${
                    activeFullSignal.smc.inEntryZone
                      ? 'text-emerald-400'
                      : activeFullSignal.smc.entryZoneStatus === 'APPROACHING_ZONE'
                        ? 'text-amber-300'
                        : 'text-slate-300'
                  }`}
                >
                  {activeFullSignal.smc.inEntryZone
                    ? 'IN PERFECT ZONE'
                    : activeFullSignal.smc.entryZoneStatus === 'APPROACHING_ZONE'
                      ? `APPROACHING (${activeFullSignal.smc.zoneDistancePct.toFixed(2)}%)`
                      : `WAIT (${activeFullSignal.smc.zoneDistancePct.toFixed(2)}% AWAY)`}
                </div>
                <div className="text-[10px] text-slate-400 font-sans mt-0.5 truncate">
                  {activeFullSignal.smc.zoneLabel}
                </div>
              </div>

              <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                <div className="text-[11px] text-slate-400 font-sans">Order Block (OB)</div>
                <div className="text-slate-100 font-medium mt-0.5">
                  {activeFullSignal.smc.bullishOb
                    ? `Demand $${formatPrice(activeFullSignal.smc.bullishOb.low)}–$${formatPrice(activeFullSignal.smc.bullishOb.high)}`
                    : activeFullSignal.smc.bearishOb
                      ? `Supply $${formatPrice(activeFullSignal.smc.bearishOb.low)}–$${formatPrice(activeFullSignal.smc.bearishOb.high)}`
                      : 'No Fresh OB'}
                </div>
                <div className="text-[10px] text-slate-400 font-sans mt-0.5">
                  BOS: {activeFullSignal.smc.bosDirection.replace('_BOS', '')}
                </div>
              </div>

              <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                <div className="text-[11px] text-slate-400 font-sans">Liquidity Sweep</div>
                <div
                  className={`font-medium mt-0.5 ${
                    activeFullSignal.smc.liquiditySweep === 'SSL_SWEEP'
                      ? 'text-emerald-400'
                      : activeFullSignal.smc.liquiditySweep === 'BSL_SWEEP'
                        ? 'text-rose-400'
                        : 'text-slate-300'
                  }`}
                >
                  {activeFullSignal.smc.liquiditySweep === 'SSL_SWEEP'
                    ? 'SSL Swept (Bull Trap)'
                    : activeFullSignal.smc.liquiditySweep === 'BSL_SWEEP'
                      ? 'BSL Swept (Bear Trap)'
                      : 'Awaiting Sweep'}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                  BSL {activeFullSignal.smc.nearestBslPool ? `$${formatPrice(activeFullSignal.smc.nearestBslPool)}` : '—'} · SSL{' '}
                  {activeFullSignal.smc.nearestSslPool ? `$${formatPrice(activeFullSignal.smc.nearestSslPool)}` : '—'}
                </div>
              </div>

              <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                <div className="text-[11px] text-slate-400 font-sans">FVG &amp; Rejection</div>
                <div className="text-slate-100 font-medium mt-0.5">
                  {activeFullSignal.smc.fvgZone
                    ? `${activeFullSignal.smc.fvgZone.type} FVG`
                    : 'No Active FVG'}
                </div>
                <div className="text-[10px] text-slate-400 font-sans mt-0.5">
                  {activeFullSignal.smc.rejectionConfirmed
                    ? 'Wick Rejection Confirmed'
                    : `SMC Confluence ${activeFullSignal.smc.smcConfluenceScore}%`}
                </div>
              </div>
            </div>
          )}

          {/* Indicators Summary Strip */}
          {(activeFullSignal || rsi14 !== undefined) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs font-mono tabular-nums">
              {rsi14 !== undefined && (
                <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                  <div className="text-[11px] text-slate-400 font-sans">RSI(14)</div>
                  <div className="text-slate-100 font-medium mt-0.5">{rsi14.toFixed(1)}</div>
                </div>
              )}
              {atrPct !== undefined && (
                <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                  <div className="text-[11px] text-slate-400 font-sans">ATR(14) Vol</div>
                  <div className="text-slate-100 font-medium mt-0.5">{atrPct.toFixed(2)}%</div>
                </div>
              )}
              {volumeRatio !== undefined && (
                <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                  <div className="text-[11px] text-slate-400 font-sans">Volume Ratio</div>
                  <div className="text-slate-100 font-medium mt-0.5">{volumeRatio.toFixed(2)}x</div>
                </div>
              )}
              {activeFullSignal && (
                <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                  <div className="text-[11px] text-slate-400 font-sans">Bollinger %B</div>
                  <div className="text-slate-100 font-medium mt-0.5">
                    {(activeFullSignal.indicators.bbPercentB * 100).toFixed(0)}%
                  </div>
                </div>
              )}
              {swingLow !== undefined && (
                <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                  <div className="text-[11px] text-slate-400 font-sans">Swing Support</div>
                  <div className="text-emerald-400 font-medium mt-0.5">
                    ${formatPrice(swingLow)}
                  </div>
                </div>
              )}
              {swingHigh !== undefined && (
                <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-2.5">
                  <div className="text-[11px] text-slate-400 font-sans">Swing Resistance</div>
                  <div className="text-rose-400 font-medium mt-0.5">
                    ${formatPrice(swingHigh)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* All Timeframes Entry & Exit Comparison Table */}
          <div className="bg-[#0B0F17] border border-slate-800 rounded-md overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-100">
                All Timeframes Entry &amp; Exit Matrix ({baseAsset}/USDC)
              </span>
              <span className="text-[11px] text-slate-400">Click any timeframe to inspect chart</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-sans text-slate-400 bg-[#0F1520]">
                    <th className="py-2 px-3">TF</th>
                    <th className="py-2 px-3">Signal</th>
                    <th className="py-2 px-3 text-right">Score</th>
                    <th className="py-2 px-3 text-right">Entry Zone</th>
                    <th className="py-2 px-3 text-right">Stop Loss</th>
                    <th className="py-2 px-3 text-right">TP1 / TP2</th>
                    <th className="py-2 px-3 text-right">R:R</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {ALL_TIMEFRAMES.map((tf) => {
                    const row =
                      (primarySignal?.timeframe === tf ? primarySignal : null) ??
                      fetchedSignals[tf] ??
                      mtfMap[tf];
                    const isRowSelected = activeTf === tf;

                    return (
                      <tr
                        key={tf}
                        onClick={() => setActiveTf(tf)}
                        className={`cursor-pointer transition-colors ${
                          isRowSelected ? 'bg-sky-500/10' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2 px-3 font-semibold text-slate-200 whitespace-nowrap">
                          {tf.toUpperCase()}
                          {row && (
                            <span className="text-[10px] font-normal text-slate-500 ml-1.5 uppercase">
                              {row.tradeStyle}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          {!row ? (
                            <span className="text-slate-500">Pending...</span>
                          ) : row.direction === 'LONG' ? (
                            <span className="text-emerald-400 font-semibold">
                              BUY {row.suggestedLeverage}x
                            </span>
                          ) : row.direction === 'SHORT' ? (
                            <span className="text-rose-400 font-semibold">
                              SELL {row.suggestedLeverage}x
                            </span>
                          ) : (
                            <span className="text-slate-400">NEUTRAL</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-200">
                          {row ? `${row.confidence}%` : '--'}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-200 whitespace-nowrap">
                          {row ? `$${formatPrice(row.entryMin)} – $${formatPrice(row.entryMax)}` : '--'}
                        </td>
                        <td className="py-2 px-3 text-right text-rose-400 whitespace-nowrap">
                          {row ? `$${formatPrice(row.stopLoss)}` : '--'}
                        </td>
                        <td className="py-2 px-3 text-right text-emerald-400 whitespace-nowrap">
                          {row ? `$${formatPrice(row.tp1)} / $${formatPrice(row.tp2)}` : '--'}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-300">
                          {row ? `1:${row.riskRewardRatio.toFixed(1)}` : '--'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Technical Confluence Reasons */}
          {reasons.length > 0 && (
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <div className="text-xs font-semibold text-slate-100">
                Technical Confluence ({activeTf.toUpperCase()})
              </div>
              <ul className="space-y-1.5 text-xs text-slate-300">
                {reasons.map((reason, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-sky-400 mt-0.5">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Live Risk Management Calculator */}
          {activeFullSignal && <RiskManagementPanel signal={activeFullSignal} />}
        </div>
      </div>
    </div>
  );
};
