import React, { useMemo, useState } from 'react';
import type { FuturesSignal } from '../types';
import { formatCandleTime, formatPrice } from '../utils/format';

interface CandlestickChartProps {
  signal: FuturesSignal;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({ signal }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const candles = signal.chartCandles;

  const width = 680;
  const height = 270;
  const padLeft = 10;
  const padRight = 68;
  const padTop = 16;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const bounds = useMemo(() => {
    if (!candles.length) {
      return { minPrice: 0, maxPrice: 1 };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const c of candles) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
      if (c.ema9 !== null) {
        min = Math.min(min, c.ema9);
        max = Math.max(max, c.ema9);
      }
      if (c.ema21 !== null) {
        min = Math.min(min, c.ema21);
        max = Math.max(max, c.ema21);
      }
      if (c.ema50 !== null) {
        min = Math.min(min, c.ema50);
        max = Math.max(max, c.ema50);
      }
    }

    // Include Entry Zone, Order Blocks, and Stop Loss / TP1 in range so trader sees zone context
    if (signal.entryMin > 0 && signal.entryMax > 0) {
      min = Math.min(min, signal.entryMin);
      max = Math.max(max, signal.entryMax);
    }
    if (signal.smc?.bullishOb) {
      min = Math.min(min, signal.smc.bullishOb.low);
      max = Math.max(max, signal.smc.bullishOb.high);
    }
    if (signal.smc?.bearishOb) {
      min = Math.min(min, signal.smc.bearishOb.low);
      max = Math.max(max, signal.smc.bearishOb.high);
    }
    if (signal.direction !== 'NEUTRAL') {
      min = Math.min(min, signal.stopLoss, signal.tp1);
      max = Math.max(max, signal.stopLoss, signal.tp1);
    }

    const span = Math.max(max - min, max * 0.005);
    return {
      minPrice: min - span * 0.08,
      maxPrice: max + span * 0.08,
    };
  }, [candles, signal.direction, signal.stopLoss, signal.tp1, signal.entryMin, signal.entryMax, signal.smc]);

  if (!candles.length) {
    return (
      <div className="h-[270px] flex items-center justify-center border border-slate-800 rounded-lg bg-[#0B0F17] text-xs text-slate-400">
        No candle data available for {signal.symbol}
      </div>
    );
  }

  const priceRange = Math.max(bounds.maxPrice - bounds.minPrice, 1e-9);
  const toY = (price: number) =>
    padTop + ((bounds.maxPrice - price) / priceRange) * plotH;

  const stepX = plotW / candles.length;
  const bodyW = Math.max(2.5, Math.min(7, stepX * 0.62));

  const buildEmaPath = (key: 'ema9' | 'ema21' | 'ema50') => {
    let d = '';
    candles.forEach((c, idx) => {
      const val = c[key];
      if (val === null) return;
      const x = padLeft + idx * stepX + stepX / 2;
      const y = toY(val);
      d += d === '' ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return d;
  };

  const ema9Path = buildEmaPath('ema9');
  const ema21Path = buildEmaPath('ema21');
  const ema50Path = buildEmaPath('ema50');

  // Y-axis ticks (4 clean levels)
  const yTicks = [0, 0.33, 0.66, 1].map((ratio) => {
    const price = bounds.maxPrice - ratio * priceRange;
    return { price, y: toY(price) };
  });

  const hovered = hoverIdx !== null && candles[hoverIdx] ? candles[hoverIdx] : candles[candles.length - 1];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const idx = Math.floor((relX - padLeft) / stepX);
    if (idx >= 0 && idx < candles.length) {
      setHoverIdx(idx);
    }
  };

  return (
    <div className="border border-slate-800 rounded-lg bg-[#0B0F17] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-800/80 text-xs">
        <div className="flex items-center gap-3 font-mono tabular-nums text-slate-300">
          <span className="text-slate-400">
            {formatCandleTime(hovered.timestamp, signal.timeframe)}
          </span>
          <span>O {formatPrice(hovered.open)}</span>
          <span>H {formatPrice(hovered.high)}</span>
          <span>L {formatPrice(hovered.low)}</span>
          <span className={hovered.close >= hovered.open ? 'text-emerald-400' : 'text-rose-400'}>
            C {formatPrice(hovered.close)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          {signal.smc?.bullishOb && <span className="text-emerald-400">Demand OB</span>}
          {signal.smc?.bearishOb && <span className="text-rose-400">Supply OB</span>}
          <span className="text-sky-400">EMA9</span>
          <span className="text-amber-400">EMA21</span>
          <span className="text-slate-300">EMA50</span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto block select-none cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Horizontal Gridlines & Right Price Axis */}
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line
              x1={padLeft}
              y1={tick.y}
              x2={width - padRight}
              y2={tick.y}
              stroke="#1E293B"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <text
              x={width - padRight + 6}
              y={tick.y + 3}
              fill="#64748B"
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
            >
              {formatPrice(tick.price)}
            </text>
          </g>
        ))}

        {/* Bullish Order Block Zone */}
        {signal.smc?.bullishOb && (
          <g>
            <rect
              x={padLeft}
              y={toY(signal.smc.bullishOb.high)}
              width={plotW}
              height={Math.max(3, toY(signal.smc.bullishOb.low) - toY(signal.smc.bullishOb.high))}
              fill="#10B981"
              opacity="0.11"
            />
            <text
              x={width - padRight - 6}
              y={toY(signal.smc.bullishOb.high) + 10}
              textAnchor="end"
              fill="#34D399"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
              opacity="0.85"
            >
              Bullish OB
            </text>
          </g>
        )}

        {/* Bearish Order Block Zone */}
        {signal.smc?.bearishOb && (
          <g>
            <rect
              x={padLeft}
              y={toY(signal.smc.bearishOb.high)}
              width={plotW}
              height={Math.max(3, toY(signal.smc.bearishOb.low) - toY(signal.smc.bearishOb.high))}
              fill="#EF4444"
              opacity="0.11"
            />
            <text
              x={width - padRight - 6}
              y={toY(signal.smc.bearishOb.low) - 3}
              textAnchor="end"
              fill="#FB7185"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
              opacity="0.85"
            >
              Bearish OB
            </text>
          </g>
        )}

        {/* Entry Zone Band */}
        {signal.entryMin > 0 && signal.entryMax > signal.entryMin && (
          <rect
            x={padLeft}
            y={toY(signal.entryMax)}
            width={plotW}
            height={Math.max(2, toY(signal.entryMin) - toY(signal.entryMax))}
            fill="#38BDF8"
            opacity="0.09"
          />
        )}

        {/* Actionable Entry / Stop Loss / TP1 Levels */}
        {signal.direction !== 'NEUTRAL' && (
          <g>
            {/* TP1 Line */}
            <line
              x1={padLeft}
              y1={toY(signal.tp1)}
              x2={width - padRight}
              y2={toY(signal.tp1)}
              stroke="#10B981"
              strokeWidth="1"
              strokeDasharray="4 3"
              opacity="0.75"
            />
            <text
              x={padLeft + 4}
              y={toY(signal.tp1) - 4}
              fill="#10B981"
              fontSize="9.5"
              fontFamily="JetBrains Mono, monospace"
            >
              TP1 {formatPrice(signal.tp1)}
            </text>

            {/* Stop Loss Line */}
            <line
              x1={padLeft}
              y1={toY(signal.stopLoss)}
              x2={width - padRight}
              y2={toY(signal.stopLoss)}
              stroke="#EF4444"
              strokeWidth="1"
              strokeDasharray="4 3"
              opacity="0.75"
            />
            <text
              x={padLeft + 4}
              y={toY(signal.stopLoss) - 4}
              fill="#EF4444"
              fontSize="9.5"
              fontFamily="JetBrains Mono, monospace"
            >
              SL {formatPrice(signal.stopLoss)}
            </text>
          </g>
        )}

        {/* Current Price Reference Line */}
        <line
          x1={padLeft}
          y1={toY(signal.lastPrice)}
          x2={width - padRight}
          y2={toY(signal.lastPrice)}
          stroke="#38BDF8"
          strokeWidth="1"
          strokeDasharray="2 2"
          opacity="0.55"
        />

        {/* EMA Overlays */}
        {ema50Path && (
          <path d={ema50Path} fill="none" stroke="#94A3B8" strokeWidth="1.25" opacity="0.75" />
        )}
        {ema21Path && (
          <path d={ema21Path} fill="none" stroke="#F59E0B" strokeWidth="1.35" opacity="0.9" />
        )}
        {ema9Path && (
          <path d={ema9Path} fill="none" stroke="#38BDF8" strokeWidth="1.4" />
        )}

        {/* Candles */}
        {candles.map((c, idx) => {
          const xCenter = padLeft + idx * stepX + stepX / 2;
          const isBull = c.close >= c.open;
          const color = isBull ? '#10B981' : '#EF4444';
          const yHigh = toY(c.high);
          const yLow = toY(c.low);
          const yOpen = toY(c.open);
          const yClose = toY(c.close);
          const bodyTop = Math.min(yOpen, yClose);
          const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));

          return (
            <g key={c.timestamp}>
              <line
                x1={xCenter}
                y1={yHigh}
                x2={xCenter}
                y2={yLow}
                stroke={color}
                strokeWidth="1.15"
              />
              <rect
                x={xCenter - bodyW / 2}
                y={bodyTop}
                width={bodyW}
                height={bodyH}
                fill={color}
                rx="0.5"
              />
            </g>
          );
        })}

        {/* Hover Crosshair */}
        {hoverIdx !== null && candles[hoverIdx] && (
          <g>
            <line
              x1={padLeft + hoverIdx * stepX + stepX / 2}
              y1={padTop}
              x2={padLeft + hoverIdx * stepX + stepX / 2}
              y2={height - padBottom}
              stroke="#475569"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <line
              x1={padLeft}
              y1={toY(candles[hoverIdx].close)}
              x2={width - padRight}
              y2={toY(candles[hoverIdx].close)}
              stroke="#475569"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          </g>
        )}

        {/* X-Axis Timestamps */}
        {[0, Math.floor(candles.length / 2), candles.length - 1].map((idx) => {
          const c = candles[idx];
          if (!c) return null;
          const x = padLeft + idx * stepX + stepX / 2;
          return (
            <text
              key={idx}
              x={x}
              y={height - 6}
              textAnchor={idx === 0 ? 'start' : idx === candles.length - 1 ? 'end' : 'middle'}
              fill="#64748B"
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
            >
              {formatCandleTime(c.timestamp, signal.timeframe)}
            </text>
          );
        })}
      </svg>
    </div>
  );
};
