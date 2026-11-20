import React, { useMemo, useState } from 'react';
import type { GlobalSentiment } from '../types';

interface GlobalSentimentIndicatorProps {
  sentiment: GlobalSentiment | undefined;
}

type SentimentMode = 'fng' | 'ratio';

export const GlobalSentimentIndicator: React.FC<GlobalSentimentIndicatorProps> = ({
  sentiment,
}) => {
  const [mode, setMode] = useState<SentimentMode>('fng');

  const hasFng = sentiment?.fearGreedValue !== null && sentiment?.fearGreedValue !== undefined;
  const activeMode: SentimentMode = mode === 'fng' && !hasFng ? 'ratio' : mode;

  const series = useMemo(() => {
    if (!sentiment) return [];
    if (activeMode === 'fng' && sentiment.fearGreedHistory.length > 0) {
      return sentiment.fearGreedHistory.map((p) => p.value);
    }
    if (sentiment.bullBearHistory.length > 1) {
      return sentiment.bullBearHistory.map((p) => p.value);
    }
    return [sentiment.bullishRatioPct, sentiment.bullishRatioPct];
  }, [sentiment, activeMode]);

  const currentVal = useMemo(() => {
    if (!sentiment) return null;
    if (activeMode === 'fng') return sentiment.fearGreedValue;
    return sentiment.bullishRatioPct;
  }, [sentiment, activeMode]);

  const semanticTone = useMemo(() => {
    if (currentVal === null) {
      return {
        textClass: 'text-slate-300',
        stroke: '#94A3B8',
        fill: 'rgba(148, 163, 184, 0.14)',
        label: 'Loading',
      };
    }
    if (activeMode === 'fng') {
      const label = sentiment?.fearGreedClassification ?? 'Neutral';
      if (currentVal <= 35) {
        return {
          textClass: 'text-rose-400',
          stroke: '#EF4444',
          fill: 'rgba(239, 68, 68, 0.16)',
          label,
        };
      }
      if (currentVal >= 65) {
        return {
          textClass: 'text-emerald-400',
          stroke: '#10B981',
          fill: 'rgba(16, 185, 129, 0.16)',
          label,
        };
      }
      return {
        textClass: 'text-amber-400',
        stroke: '#F59E0B',
        fill: 'rgba(245, 158, 11, 0.16)',
        label,
      };
    }

    // Bull / Bear ratio mode
    const label =
      currentVal >= 60 ? 'Bullish' : currentVal <= 40 ? 'Bearish' : 'Balanced';
    if (currentVal >= 60) {
      return {
        textClass: 'text-emerald-400',
        stroke: '#10B981',
        fill: 'rgba(16, 185, 129, 0.16)',
        label,
      };
    }
    if (currentVal <= 40) {
      return {
        textClass: 'text-rose-400',
        stroke: '#EF4444',
        fill: 'rgba(239, 68, 68, 0.16)',
        label,
      };
    }
    return {
      textClass: 'text-amber-400',
      stroke: '#F59E0B',
      fill: 'rgba(245, 158, 11, 0.16)',
      label,
    };
  }, [currentVal, activeMode, sentiment?.fearGreedClassification]);

  const sparkSvg = useMemo(() => {
    const w = 68;
    const h = 22;
    const padY = 3;
    const pts = series.length >= 2 ? series : [50, 50];
    const min = Math.min(...pts, 0);
    const max = Math.max(...pts, 100);
    const range = Math.max(max - min, 1);

    const coords = pts.map((val, idx) => {
      const x = (idx / (pts.length - 1)) * (w - 4) + 2;
      const y = padY + ((max - val) / range) * (h - padY * 2);
      return { x, y };
    });

    const linePath = coords
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(' ');
    const last = coords[coords.length - 1];
    const first = coords[0];
    const areaPath = `${linePath} L ${last.x.toFixed(1)} ${h} L ${first.x.toFixed(1)} ${h} Z`;

    return { w, h, linePath, areaPath, last };
  }, [series]);

  if (!sentiment) {
    return (
      <div className="hidden md:flex items-center gap-3 text-xs text-slate-500 whitespace-nowrap shrink-0">
        <span>Sentiment loading...</span>
      </div>
    );
  }

  const tooltipSummary = [
    sentiment.fearGreedValue !== null
      ? `Fear & Greed: ${sentiment.fearGreedValue}/100 (${sentiment.fearGreedClassification})`
      : null,
    `Scanner Bias: ${sentiment.bullishCount} Long / ${sentiment.bearishCount} Short / ${sentiment.neutralCount} Neutral`,
    `Avg RSI(14): ${sentiment.marketAvgRsi}`,
    'Click to switch between Fear & Greed (14d) and Bull/Bear Ratio',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={() => setMode((m) => (m === 'fng' ? 'ratio' : 'fng'))}
      title={tooltipSummary}
      className="hidden md:flex items-center gap-3 px-2.5 py-1 rounded-md hover:bg-slate-800/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500"
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-400">
          {activeMode === 'fng' ? 'Fear & Greed' : 'Bull/Bear Ratio'}
        </span>
        <span className={`font-mono tabular-nums font-semibold ${semanticTone.textClass}`}>
          {activeMode === 'fng'
            ? `${currentVal ?? '--'} · ${semanticTone.label}`
            : `${currentVal ?? '--'}% Bull · ${sentiment.bullishCount}L/${sentiment.bearishCount}S`}
        </span>
      </div>

      <svg
        width={sparkSvg.w}
        height={sparkSvg.h}
        viewBox={`0 0 ${sparkSvg.w} ${sparkSvg.h}`}
        className="shrink-0 overflow-visible"
        aria-hidden="true"
      >
        <path d={sparkSvg.areaPath} fill={semanticTone.fill} />
        <path
          d={sparkSvg.linePath}
          fill="none"
          stroke={semanticTone.stroke}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={sparkSvg.last.x}
          cy={sparkSvg.last.y}
          r="2.25"
          fill={semanticTone.stroke}
        />
      </svg>
    </button>
  );
};
