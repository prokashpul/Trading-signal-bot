import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ArrowDownRight, ArrowUpRight, Maximize2, Star } from 'lucide-react';
import type { FuturesSignal, Timeframe } from '../types';
import { formatCompactVolume, formatPrice } from '../utils/format';

interface MarketHeatmapProps {
  signals: FuturesSignal[];
  selectedSymbol: string | null;
  prioritySet: Set<string>;
  isScanning: boolean;
  onSelectSymbol: (symbol: string) => void;
  onOpenSignalDetail: (symbol: string, timeframe?: Timeframe) => void;
  onResetFilters: () => void;
  onTriggerScan: () => void;
}

type SizingMode = 'volume' | 'equal';

interface HeatmapTileDatum {
  signal: FuturesSignal;
  volumeIntensity: number; // 0..1
  fillColor: string;
  textColor: string;
  subTextColor: string;
  areaValue: number;
}

interface HierarchyNodeInput {
  name: string;
  children?: HeatmapTileDatum[];
  signal?: FuturesSignal;
  volumeIntensity?: number;
  fillColor?: string;
  textColor?: string;
  subTextColor?: string;
  areaValue?: number;
}

function computeBivariateColor(
  changePct: number,
  volumeIntensity: number,
): { fillColor: string; textColor: string; subTextColor: string } {
  const positiveScale = d3
    .scaleLinear<string>()
    .domain([0, 2.5, 8])
    .range(['#1C2636', '#059669', '#10B981'])
    .clamp(true);

  const negativeScale = d3
    .scaleLinear<string>()
    .domain([-8, -2.5, 0])
    .range(['#E11D48', '#9F1239', '#1C2636'])
    .clamp(true);

  const perfColor =
    changePct >= 0 ? positiveScale(changePct) : negativeScale(changePct);

  // Modulate saturation/luminance against neutral slate by trade volume intensity
  const intensityFactor = 0.28 + 0.72 * Math.max(0, Math.min(1, volumeIntensity));
  const fillColor = d3.interpolateRgb('#131A26', perfColor)(intensityFactor);

  const lightness = d3.lab(fillColor).l;
  const isBright = lightness > 58;
  return {
    fillColor,
    textColor: isBright ? '#090D14' : '#F8FAFC',
    subTextColor: isBright ? 'rgba(9, 13, 20, 0.78)' : 'rgba(241, 245, 249, 0.78)',
  };
}

export const MarketHeatmap: React.FC<MarketHeatmapProps> = ({
  signals,
  selectedSymbol,
  prioritySet,
  isScanning,
  onSelectSymbol,
  onOpenSignalDetail,
  onResetFilters,
  onTriggerScan,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 760, height: 520 });
  const [sizingMode, setSizingMode] = useState<SizingMode>('volume');
  const [hoveredTile, setHoveredTile] = useState<{
    tile: HeatmapTileDatum;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width));
      const height = Math.max(420, Math.min(600, Math.round(width * 0.68)));
      setDimensions((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { tiles, volRange, summary } = useMemo(() => {
    if (signals.length === 0) {
      return {
        tiles: [] as Array<d3.HierarchyRectangularNode<HierarchyNodeInput> & { datum: HeatmapTileDatum }>,
        volRange: { min: 0, max: 0 },
        summary: { gainers: 0, losers: 0, highVolCount: 0, avgChange: 0 },
      };
    }

    const positiveVolumes = signals
      .map((s) => s.quoteVolume24h)
      .filter((v) => Number.isFinite(v) && v > 0);
    const minVol = positiveVolumes.length > 0 ? Math.min(...positiveVolumes) : 1;
    const maxVol = positiveVolumes.length > 0 ? Math.max(...positiveVolumes) : 1;

    const logVolScale =
      maxVol > minVol * 1.01
        ? d3.scaleLog<number>().domain([minVol, maxVol]).range([0.15, 1]).clamp(true)
        : null;

    const ratioScale = d3
      .scaleLinear<number>()
      .domain([0.4, 2.5])
      .range([0.1, 1])
      .clamp(true);

    let gainers = 0;
    let losers = 0;
    let highVolCount = 0;
    let totalChange = 0;

    const items: HeatmapTileDatum[] = signals.map((s) => {
      if (s.priceChange24hPct >= 0) gainers += 1;
      else losers += 1;
      totalChange += s.priceChange24hPct;

      const quoteVolScore = logVolScale
        ? logVolScale(Math.max(s.quoteVolume24h, minVol))
        : 0.55;
      const ratioScore = ratioScale(s.indicators.volumeRatio || 1);
      const volumeIntensity = Math.max(
        0.1,
        Math.min(1, 0.72 * quoteVolScore + 0.28 * ratioScore),
      );
      if (volumeIntensity >= 0.7 || (s.indicators.volumeRatio || 0) >= 1.5) {
        highVolCount += 1;
      }

      const { fillColor, textColor, subTextColor } = computeBivariateColor(
        s.priceChange24hPct,
        volumeIntensity,
      );

      const areaValue =
        sizingMode === 'volume'
          ? Math.max(1, Math.pow(Math.max(s.quoteVolume24h, minVol || 10_000), 0.36))
          : 1;

      return {
        signal: s,
        volumeIntensity,
        fillColor,
        textColor,
        subTextColor,
        areaValue,
      };
    });

    const rootData: HierarchyNodeInput = {
      name: 'market',
      children: items.map((item) => ({
        name: item.signal.symbol,
        ...item,
      })),
    };

    const root = d3
      .hierarchy<HierarchyNodeInput>(rootData)
      .sum((d) => d.areaValue ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const treemapLayout = d3
      .treemap<HierarchyNodeInput>()
      .size([dimensions.width, dimensions.height])
      .paddingOuter(4)
      .paddingInner(3)
      .round(true)
      .tile(d3.treemapSquarify.ratio(1.25));

    const laidOut = treemapLayout(root);
    const leaves = laidOut.leaves().map((leaf) => {
      const datum: HeatmapTileDatum = {
        signal: leaf.data.signal!,
        volumeIntensity: leaf.data.volumeIntensity ?? 0.5,
        fillColor: leaf.data.fillColor ?? '#1C2636',
        textColor: leaf.data.textColor ?? '#F8FAFC',
        subTextColor: leaf.data.subTextColor ?? 'rgba(241, 245, 249, 0.78)',
        areaValue: leaf.data.areaValue ?? 1,
      };
      return Object.assign(leaf, { datum });
    });

    return {
      tiles: leaves,
      volRange: { min: minVol, max: maxVol },
      summary: {
        gainers,
        losers,
        highVolCount,
        avgChange: totalChange / signals.length,
      },
    };
  }, [signals, sizingMode, dimensions.width, dimensions.height]);

  // Precompute 2D D3 Bivariate Color Matrix swatches (Perf x Volume Intensity)
  const legendMatrix = useMemo(() => {
    const perfSteps = [-8, -4, -1.5, 0, 1.5, 4, 8];
    const volSteps = [
      { label: 'High Vol', val: 0.95 },
      { label: 'Med Vol', val: 0.58 },
      { label: 'Low Vol', val: 0.22 },
    ];
    return volSteps.map((vs) => ({
      label: vs.label,
      cells: perfSteps.map((p) => ({
        perf: p,
        color: computeBivariateColor(p, vs.val).fillColor,
      })),
    }));
  }, []);

  if (isScanning && signals.length === 0) {
    return (
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-4 gap-2 h-[440px]">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="bg-slate-800/50 rounded animate-pulse border border-slate-800"
            />
          ))}
        </div>
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <div className="py-14 px-4 text-center">
        <p className="text-sm text-slate-300 font-medium">
          No pairs match the current heatmap filter
        </p>
        <p className="text-xs text-slate-400 mt-1">
          Reset your filters or run a live scan to render the D3 market treemap.
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onResetFilters}
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
      </div>
    );
  }

  const activeHovered = hoveredTile?.tile ?? null;

  return (
    <div className="p-4 space-y-3">
      {/* Top Heatmap Controls & Market Breadth Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums text-slate-300">
          <span className="text-emerald-400 font-semibold">{summary.gainers} Up</span>
          <span className="text-slate-600">·</span>
          <span className="text-rose-400 font-semibold">{summary.losers} Down</span>
          <span className="text-slate-600">·</span>
          <span className={summary.avgChange >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
            Avg {summary.avgChange >= 0 ? '+' : ''}
            {summary.avgChange.toFixed(2)}%
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-sky-300">{summary.highVolCount} High-Vol</span>
        </div>

        <div className="flex items-center gap-1 p-0.5 bg-[#0B0F17] border border-slate-800 rounded-md">
          <button
            type="button"
            onClick={() => setSizingMode('volume')}
            className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sizingMode === 'volume'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Size: 24h Volume
          </button>
          <button
            type="button"
            onClick={() => setSizingMode('equal')}
            className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sizingMode === 'equal'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Size: Equal Grid
          </button>
        </div>
      </div>

      {/* D3 Treemap Canvas */}
      <div
        ref={containerRef}
        className="relative w-full bg-[#0B0F17] border border-slate-800 rounded-md overflow-hidden select-none"
        onMouseLeave={() => setHoveredTile(null)}
      >
        <svg
          width={dimensions.width}
          height={dimensions.height}
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          className="block w-full h-auto"
          role="img"
          aria-label="D3 Market Performance and Volume Intensity Heatmap"
        >
          {tiles.map((leaf) => {
            const tile = leaf.datum;
            const sig = tile.signal;
            const x = leaf.x0;
            const y = leaf.y0;
            const w = Math.max(0, leaf.x1 - leaf.x0);
            const h = Math.max(0, leaf.y1 - leaf.y0);
            const isSelected = selectedSymbol === sig.symbol;
            const isPriority = prioritySet.has(sig.symbol);
            const isActionable = sig.direction !== 'NEUTRAL';

            const showFull = w >= 88 && h >= 64;
            const showMedium = w >= 54 && h >= 42;
            const showCompact = w >= 32 && h >= 24;
            const volPct = Math.round(tile.volumeIntensity * 100);

            return (
              <g
                key={sig.symbol}
                transform={`translate(${x},${y})`}
                role="button"
                tabIndex={0}
                aria-label={`${sig.baseAsset} 24h ${sig.priceChange24hPct >= 0 ? '+' : ''}${sig.priceChange24hPct.toFixed(2)}%, Volume ${formatCompactVolume(sig.quoteVolume24h)}, Intensity ${volPct}%`}
                className="cursor-pointer focus:outline-none"
                onClick={() => onSelectSymbol(sig.symbol)}
                onDoubleClick={() => onOpenSignalDetail(sig.symbol, sig.timeframe)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectSymbol(sig.symbol);
                  }
                }}
                onMouseEnter={(e) => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  const relX = rect ? e.clientX - rect.left : x + w / 2;
                  const relY = rect ? e.clientY - rect.top : y + h / 2;
                  setHoveredTile({ tile, x: relX, y: relY });
                }}
                onMouseMove={(e) => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setHoveredTile({
                    tile,
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                  });
                }}
              >
                <rect
                  width={w}
                  height={h}
                  rx={4}
                  ry={4}
                  fill={tile.fillColor}
                  stroke={
                    isSelected
                      ? '#38BDF8'
                      : isActionable
                        ? sig.direction === 'LONG'
                          ? '#34D399'
                          : '#FB7185'
                        : 'rgba(15, 23, 42, 0.85)'
                  }
                  strokeWidth={isSelected ? 2 : isActionable ? 1.5 : 1}
                  className="transition-opacity duration-150 hover:opacity-90"
                />

                {/* Volume Intensity Bar at bottom edge of tile */}
                {w >= 26 && h >= 18 && (
                  <rect
                    x={3}
                    y={Math.max(2, h - 4)}
                    width={Math.max(2, (w - 6) * tile.volumeIntensity)}
                    height={2}
                    rx={1}
                    fill={
                      tile.volumeIntensity >= 0.7
                        ? '#FBBF24'
                        : 'rgba(248, 250, 252, 0.35)'
                    }
                  />
                )}

                {showCompact && (
                  <g pointerEvents="none">
                    {/* Symbol Name */}
                    <text
                      x={w / 2}
                      y={showFull ? h / 2 - 12 : showMedium ? h / 2 - 6 : h / 2 - 1}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={tile.textColor}
                      fontSize={showFull ? 13 : showMedium ? 11 : 9.5}
                      fontWeight={700}
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    >
                      {isPriority ? '★ ' : ''}
                      {sig.baseAsset}
                    </text>

                    {/* 24h Price Performance */}
                    <text
                      x={w / 2}
                      y={showFull ? h / 2 + 4 : showMedium ? h / 2 + 7 : h / 2 + 9}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={tile.textColor}
                      fontSize={showFull ? 12 : showMedium ? 10 : 8.5}
                      fontWeight={600}
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    >
                      {sig.priceChange24hPct >= 0 ? '+' : ''}
                      {sig.priceChange24hPct.toFixed(showMedium ? 2 : 1)}%
                    </text>

                    {/* Volume & Intensity */}
                    {showMedium && (
                      <text
                        x={w / 2}
                        y={showFull ? h / 2 + 19 : h / 2 + 18}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={tile.subTextColor}
                        fontSize={9}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      >
                        {formatCompactVolume(sig.quoteVolume24h)} · {volPct}% Vol
                      </text>
                    )}

                    {/* Active Signal Callout inside large tiles */}
                    {showFull && isActionable && (
                      <text
                        x={w / 2}
                        y={h / 2 + 32}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={sig.direction === 'LONG' ? '#A7F3D0' : '#FECDD3'}
                        fontSize={9.5}
                        fontWeight={700}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      >
                        {sig.direction} {sig.confidence}%
                      </text>
                    )}
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Floating Interactive D3 Tooltip */}
        {activeHovered && hoveredTile && (
          <div
            className="pointer-events-none absolute z-20 w-56 bg-[#0F1520]/95 border border-slate-700 rounded-md p-2.5 shadow-lg text-xs"
            style={{
              left: Math.min(
                dimensions.width - 232,
                Math.max(8, hoveredTile.x + 14),
              ),
              top: Math.min(
                dimensions.height - 148,
                Math.max(8, hoveredTile.y + 14),
              ),
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-100 inline-flex items-center gap-1">
                {prioritySet.has(activeHovered.signal.symbol) && (
                  <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                )}
                {activeHovered.signal.baseAsset}/USDC
              </span>
              <span
                className={`font-mono tabular-nums font-semibold ${
                  activeHovered.signal.priceChange24hPct >= 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                {activeHovered.signal.priceChange24hPct >= 0 ? '+' : ''}
                {activeHovered.signal.priceChange24hPct.toFixed(2)}%
              </span>
            </div>

            <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-mono tabular-nums text-slate-300">
              <span className="text-slate-400 font-sans">Mark Price</span>
              <span className="text-right text-slate-100">
                ${formatPrice(activeHovered.signal.lastPrice)}
              </span>

              <span className="text-slate-400 font-sans">24h Volume</span>
              <span className="text-right">
                {formatCompactVolume(activeHovered.signal.quoteVolume24h)}
              </span>

              <span className="text-slate-400 font-sans">Vol Intensity</span>
              <span className="text-right text-amber-300">
                {Math.round(activeHovered.volumeIntensity * 100)}% (
                {(activeHovered.signal.indicators.volumeRatio || 1).toFixed(2)}x)
              </span>

              <span className="text-slate-400 font-sans">Signal</span>
              <span
                className={`text-right font-semibold ${
                  activeHovered.signal.direction === 'LONG'
                    ? 'text-emerald-400'
                    : activeHovered.signal.direction === 'SHORT'
                      ? 'text-rose-400'
                      : 'text-slate-400'
                }`}
              >
                {activeHovered.signal.direction} · {activeHovered.signal.confidence}%
              </span>
            </div>

            <div className="mt-2 pt-1.5 border-t border-slate-800 text-[10px] text-slate-400">
              Click to inspect · Double-click for entry/exit modal
            </div>
          </div>
        )}
      </div>

      {/* Bivariate Legend (24h Price Performance x Volume Intensity) + Active Tile Action */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-1 text-[11px]">
        <div className="flex items-center gap-3">
          <div className="space-y-0.5">
            {legendMatrix.map((row) => (
              <div key={row.label} className="flex items-center gap-1">
                <span className="w-12 text-[10px] font-mono text-slate-400 text-right pr-1">
                  {row.label}
                </span>
                {row.cells.map((cell) => (
                  <span
                    key={`${row.label}:${cell.perf}`}
                    className="w-4 h-2.5 rounded-[2px] border border-slate-900/60"
                    style={{ backgroundColor: cell.color }}
                    title={`${cell.perf >= 0 ? '+' : ''}${cell.perf}% · ${row.label}`}
                  />
                ))}
              </div>
            ))}
            <div className="flex items-center gap-1 pl-13 font-mono tabular-nums text-[9px] text-slate-500">
              <span className="w-4 text-center">-8%</span>
              <span className="w-4 text-center" />
              <span className="w-4 text-center" />
              <span className="w-4 text-center">0%</span>
              <span className="w-4 text-center" />
              <span className="w-4 text-center" />
              <span className="w-4 text-center">+8%</span>
            </div>
          </div>

          <div className="hidden sm:block text-[11px] text-slate-400 leading-snug">
            <div>Hue: 24h Price Change (-8% to +8%+)</div>
            <div className="font-mono tabular-nums text-[10px] text-slate-500">
              Brightness: Volume Intensity (
              {volRange.min > 0 ? formatCompactVolume(volRange.min) : '$0'} –{' '}
              {volRange.max > 0 ? formatCompactVolume(volRange.max) : '$0'})
            </div>
          </div>
        </div>

        {selectedSymbol && (
          <button
            type="button"
            onClick={() => {
              const found = signals.find((s) => s.symbol === selectedSymbol);
              if (found) onOpenSignalDetail(found.symbol, found.timeframe);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 rounded text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {signals.find((s) => s.symbol === selectedSymbol)?.direction === 'LONG' ? (
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
            ) : signals.find((s) => s.symbol === selectedSymbol)?.direction === 'SHORT' ? (
              <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5 text-sky-400" />
            )}
            Open {selectedSymbol.replace('USDC', '')} Entry/Exit Modal
          </button>
        )}
      </div>
    </div>
  );
};
