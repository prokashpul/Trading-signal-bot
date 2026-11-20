import React, { useEffect, useMemo, useState } from 'react';
import { Shield } from 'lucide-react';
import type { FuturesSignal } from '../types';
import { formatPrice } from '../utils/format';

interface RiskManagementPanelProps {
  signal: FuturesSignal;
}

const RISK_PRESETS = [0.5, 1, 2, 3, 5] as const;
const ATR_CUSHIONS: Array<{ label: string; mult: number }> = [
  { label: '1.35x Tight', mult: 1.35 },
  { label: '1.65x Base', mult: 1.65 },
  { label: '2.15x Swing', mult: 2.15 },
  { label: '2.75x Wide', mult: 2.75 },
];

export const RiskManagementPanel: React.FC<RiskManagementPanelProps> = ({ signal }) => {
  const [accountSizeInput, setAccountSizeInput] = useState<string>('1000');
  const [riskPct, setRiskPct] = useState<number>(1);
  const [atrMult, setAtrMult] = useState<number>(() =>
    signal.tradeStyle === 'swing' ? 2.15 : signal.tradeStyle === 'scalp' ? 1.35 : 1.65,
  );
  const [neutralBias, setNeutralBias] = useState<'LONG' | 'SHORT'>(() =>
    signal.indicators.ema9 < signal.indicators.ema50 && signal.indicators.rsi14 < 50
      ? 'SHORT'
      : 'LONG',
  );

  // Keep default ATR multiplier & neutral bias synced when switching coin or Trade Mode
  useEffect(() => {
    setAtrMult(
      signal.tradeStyle === 'swing' ? 2.15 : signal.tradeStyle === 'scalp' ? 1.35 : 1.65,
    );
    setNeutralBias(
      signal.indicators.ema9 < signal.indicators.ema50 && signal.indicators.rsi14 < 50
        ? 'SHORT'
        : 'LONG',
    );
  }, [signal.tradeStyle, signal.symbol, signal.indicators.ema9, signal.indicators.ema50, signal.indicators.rsi14]);

  const effectiveDirection: 'LONG' | 'SHORT' =
    signal.direction === 'NEUTRAL' ? neutralBias : signal.direction;

  const calc = useMemo(() => {
    const equity = Math.max(0, Number(accountSizeInput) || 0);
    const price = signal.lastPrice;
    const atr = Math.max(signal.indicators.atr14, price * 0.004);
    const atrPct = signal.indicators.atrPct;

    let volRegime = 'Moderate Vol';
    let volColor = 'text-slate-300';
    if (atrPct < 1.0) {
      volRegime = 'Low Vol';
      volColor = 'text-sky-400';
    } else if (atrPct >= 3.5) {
      volRegime = 'High Vol';
      volColor = 'text-rose-400';
    } else if (atrPct >= 2.2) {
      volRegime = 'Elevated Vol';
      volColor = 'text-amber-400';
    }

    const maxStopCapPct =
      signal.tradeStyle === 'swing' ? 0.065 : signal.tradeStyle === 'scalp' ? 0.022 : 0.038;
    const minStopFloorPct =
      signal.tradeStyle === 'swing' ? 0.009 : signal.tradeStyle === 'scalp' ? 0.0035 : 0.0055;
    const stopDistance = Math.min(
      price * maxStopCapPct,
      Math.max(price * minStopFloorPct, atr * atrMult),
    );
    const stopPct = price > 0 ? (stopDistance / price) * 100 : 2.0;

    const [r1, r2, r3] =
      signal.tradeStyle === 'swing'
        ? [1.2, 2.2, 3.6]
        : signal.tradeStyle === 'scalp'
          ? [1.0, 1.8, 2.8]
          : [1.1, 2.0, 3.2];

    const isShort = effectiveDirection === 'SHORT';
    const suggestedSl = isShort
      ? price + stopDistance
      : Math.max(price * 0.5, price - stopDistance);

    const tp1 = isShort
      ? Math.max(price * 0.5, price - stopDistance * r1)
      : price + stopDistance * r1;
    const tp2 = isShort
      ? Math.max(price * 0.4, price - stopDistance * r2)
      : price + stopDistance * r2;
    const tp3 = isShort
      ? Math.max(price * 0.25, price - stopDistance * r3)
      : price + stopDistance * r3;

    const tp1Pct = price > 0 ? Math.abs(((tp1 - price) / price) * 100) : 0;
    const tp2Pct = price > 0 ? Math.abs(((tp2 - price) / price) * 100) : 0;
    const tp3Pct = price > 0 ? Math.abs(((tp3 - price) / price) * 100) : 0;

    const riskUsd = equity * (riskPct / 100);
    const positionUsd = stopPct > 0 ? riskUsd / (stopPct / 100) : 0;
    const positionUnits = price > 0 ? positionUsd / price : 0;

    // Keep estimated liquidation distance >= 1.4x Stop Loss distance
    const maxSafeLev = stopPct > 0 ? Math.floor(85 / (stopPct * 1.4)) : 5;
    const safeLeverage = Math.max(1, Math.min(signal.tradeStyle === 'swing' ? 5 : 15, maxSafeLev));
    const requiredMarginUsd = safeLeverage > 0 ? positionUsd / safeLeverage : positionUsd;

    return {
      volRegime,
      volColor,
      atrPct,
      stopPct,
      suggestedSl,
      tp1,
      tp2,
      tp3,
      tp1Pct,
      tp2Pct,
      tp3Pct,
      r1,
      r2,
      r3,
      riskUsd,
      tp1Usd: riskUsd * r1,
      tp2Usd: riskUsd * r2,
      tp3Usd: riskUsd * r3,
      positionUsd,
      positionUnits,
      safeLeverage,
      requiredMarginUsd,
    };
  }, [accountSizeInput, riskPct, atrMult, effectiveDirection, signal]);

  return (
    <div className="pt-4 border-t border-slate-800 space-y-3.5">
      {/* Section Title & Volatility Regime */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-100">
          <Shield className="w-3.5 h-3.5 text-sky-400" />
          Risk Management
        </div>
        <div className="text-[11px] font-mono tabular-nums text-slate-400">
          ATR(14) {calc.atrPct.toFixed(2)}%
          <span className="mx-1.5 text-slate-600">·</span>
          <span className={calc.volColor}>{calc.volRegime}</span>
        </div>
      </div>

      {/* Controls: Equity, Risk %, ATR Cushion, and Direction Preview (if Neutral) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Account Equity (USDC)</label>
          <input
            type="number"
            min="10"
            step="any"
            value={accountSizeInput}
            onChange={(e) => setAccountSizeInput(e.target.value)}
            className="w-full bg-[#0B0F17] border border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-100 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Risk Per Trade</span>
            <span className="font-mono tabular-nums text-slate-200">
              ${calc.riskUsd.toFixed(2)}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1 p-0.5 bg-[#0B0F17] border border-slate-800 rounded-md">
            {RISK_PRESETS.map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => setRiskPct(pct)}
                className={`py-1 text-[11px] font-mono tabular-nums rounded transition-colors cursor-pointer ${
                  riskPct === pct
                    ? 'bg-sky-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Volatility Stop Cushion Selector */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400">Volatility Stop Cushion (ATR Multiplier)</span>
          {signal.direction === 'NEUTRAL' && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setNeutralBias('LONG')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                  neutralBias === 'LONG'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Long Sim
              </button>
              <button
                type="button"
                onClick={() => setNeutralBias('SHORT')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                  neutralBias === 'SHORT'
                    ? 'bg-rose-500/20 text-rose-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Short Sim
              </button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-4 gap-1 p-0.5 bg-[#0B0F17] border border-slate-800 rounded-md">
          {ATR_CUSHIONS.map((item) => (
            <button
              key={item.mult}
              type="button"
              onClick={() => setAtrMult(item.mult)}
              className={`py-1 px-1.5 text-[11px] font-mono tabular-nums rounded transition-colors whitespace-nowrap cursor-pointer ${
                Math.abs(atrMult - item.mult) < 0.01
                  ? 'bg-slate-800 text-slate-100 font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Risk-to-Reward Visual Ratio Bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
          <span className="text-rose-400">Risk -1R (-{calc.stopPct.toFixed(2)}%)</span>
          <span className="text-emerald-400">
            Projected R:R 1:{calc.r2.toFixed(1)} (TP2) · 1:{calc.r3.toFixed(1)} (TP3)
          </span>
        </div>
        <div className="h-2 w-full bg-[#0B0F17] rounded-full overflow-hidden flex">
          <div className="bg-rose-500/80 h-full" style={{ width: '20%' }} />
          <div className="bg-emerald-500/50 h-full border-l border-[#0B0F17]" style={{ width: '26%' }} />
          <div className="bg-emerald-500/75 h-full border-l border-[#0B0F17]" style={{ width: '24%' }} />
          <div className="bg-emerald-400 h-full border-l border-[#0B0F17]" style={{ width: '30%' }} />
        </div>
      </div>

      {/* Projected SL / TP Volatility Table */}
      <div className="bg-[#0B0F17] border border-slate-800 rounded-md overflow-hidden text-[11px] font-mono tabular-nums">
        <div className="grid grid-cols-4 px-3 py-1.5 border-b border-slate-800 text-slate-400">
          <span>Level</span>
          <span className="text-right">Price</span>
          <span className="text-right">Move</span>
          <span className="text-right">Est. PnL / R:R</span>
        </div>
        <div className="divide-y divide-slate-800/70">
          <div className="grid grid-cols-4 px-3 py-1.5">
            <span className="text-rose-400 font-medium">Stop Loss</span>
            <span className="text-right text-slate-100">${formatPrice(calc.suggestedSl)}</span>
            <span className="text-right text-rose-400">-{calc.stopPct.toFixed(2)}%</span>
            <span className="text-right text-rose-400">-${calc.riskUsd.toFixed(2)} (-1R)</span>
          </div>
          <div className="grid grid-cols-4 px-3 py-1.5">
            <span className="text-emerald-400">TP1</span>
            <span className="text-right text-slate-100">${formatPrice(calc.tp1)}</span>
            <span className="text-right text-emerald-400">+{calc.tp1Pct.toFixed(2)}%</span>
            <span className="text-right text-emerald-400">
              +${calc.tp1Usd.toFixed(2)} (1:{calc.r1})
            </span>
          </div>
          <div className="grid grid-cols-4 px-3 py-1.5">
            <span className="text-emerald-400 font-medium">TP2</span>
            <span className="text-right text-slate-100">${formatPrice(calc.tp2)}</span>
            <span className="text-right text-emerald-400">+{calc.tp2Pct.toFixed(2)}%</span>
            <span className="text-right text-emerald-400">
              +${calc.tp2Usd.toFixed(2)} (1:{calc.r2})
            </span>
          </div>
          <div className="grid grid-cols-4 px-3 py-1.5">
            <span className="text-emerald-300">TP3</span>
            <span className="text-right text-slate-100">${formatPrice(calc.tp3)}</span>
            <span className="text-right text-emerald-300">+{calc.tp3Pct.toFixed(2)}%</span>
            <span className="text-right text-emerald-300">
              +${calc.tp3Usd.toFixed(2)} (1:{calc.r3})
            </span>
          </div>
        </div>
      </div>

      {/* Position Sizing & Safe Leverage Summary */}
      <div className="grid grid-cols-3 gap-2 text-[11px] font-mono tabular-nums">
        <div className="bg-[#0B0F17] border border-slate-800 rounded-md px-2.5 py-2">
          <div className="text-slate-400">Position Size</div>
          <div className="text-slate-100 font-medium mt-0.5">
            ${calc.positionUsd.toFixed(0)} ({calc.positionUnits.toFixed(calc.positionUnits >= 10 ? 1 : 3)}{' '}
            {signal.baseAsset})
          </div>
        </div>
        <div className="bg-[#0B0F17] border border-slate-800 rounded-md px-2.5 py-2">
          <div className="text-slate-400">Safe Max Lev</div>
          <div className="text-sky-400 font-medium mt-0.5">{calc.safeLeverage}x Cross</div>
        </div>
        <div className="bg-[#0B0F17] border border-slate-800 rounded-md px-2.5 py-2">
          <div className="text-slate-400">Req. Margin</div>
          <div className="text-slate-100 font-medium mt-0.5">
            ${calc.requiredMarginUsd.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
};
