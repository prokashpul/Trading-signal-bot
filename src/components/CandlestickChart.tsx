import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Crosshair,
  Eye,
  Magnet,
  Maximize2,
  Minimize2,
  Minus,
  RotateCcw,
  Ruler,
  Square,
  Trash2,
  TrendingUp,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { FuturesSignal, Timeframe } from '../types';
import { ALL_TIMEFRAMES } from '../types';
import {
  DRAWING_COLORS,
  loadDrawingsMap,
  saveDrawingsMap,
  type AnalysisMode,
  type ChartDrawing,
  type ChartPoint,
  type DrawingTool,
} from '../types/chartDrawing';
import { formatCandleTime, formatPrice } from '../utils/format';

interface CandlestickChartProps {
  signal: FuturesSignal;
  onChangeTimeframe?: (tf: Timeframe) => void;
}

const FIB_LEVELS = [
  { ratio: 0, label: '0', color: '#94A3B8' },
  { ratio: 0.236, label: '0.236', color: '#64748B' },
  { ratio: 0.382, label: '0.382', color: '#38BDF8' },
  { ratio: 0.5, label: '0.5', color: '#F59E0B' },
  { ratio: 0.618, label: '0.618', color: '#10B981' },
  { ratio: 0.786, label: '0.786', color: '#A855F7' },
  { ratio: 1, label: '1', color: '#94A3B8' },
] as const;

const TF_DURATION_MS: Record<Timeframe, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

function formatDurationMs(ms: number): string {
  const abs = Math.abs(ms);
  const totalMins = Math.round(abs / 60_000);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}

function buildPositionLevels(
  side: 'long_pos' | 'short_pos',
  p1: ChartPoint,
  p2: ChartPoint,
  explicitSl?: number,
): { entry: number; tp: number; sl: number } {
  const entry = p1.price;
  if (side === 'long_pos') {
    if (explicitSl !== undefined) {
      const tp = p2.price > entry ? p2.price : entry * 1.02;
      const sl = explicitSl < entry ? explicitSl : entry * 0.99;
      return { entry, tp, sl };
    }
    if (p2.price >= entry) {
      const reward = Math.max(p2.price - entry, entry * 0.002);
      return { entry, tp: entry + reward, sl: entry - reward * 0.5 };
    }
    const risk = Math.max(entry - p2.price, entry * 0.0015);
    return { entry, tp: entry + risk * 2, sl: entry - risk };
  }

  // short_pos
  if (explicitSl !== undefined) {
    const tp = p2.price < entry ? p2.price : entry * 0.98;
    const sl = explicitSl > entry ? explicitSl : entry * 1.01;
    return { entry, tp, sl };
  }
  if (p2.price <= entry) {
    const reward = Math.max(entry - p2.price, entry * 0.002);
    return { entry, tp: entry - reward, sl: entry + reward * 0.5 };
  }
  const risk = Math.max(p2.price - entry, entry * 0.0015);
  return { entry, tp: entry - risk * 2, sl: entry + risk };
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  signal,
  onChangeTimeframe,
}) => {
  const candles = signal.chartCandles;
  const chartKey = `${signal.symbol}:${signal.timeframe}`;

  const [isFullPage, setIsFullPage] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('both');
  const [showEmas, setShowEmas] = useState(true);
  const [activeTool, setActiveTool] = useState<DrawingTool>('crosshair');
  const [activeColor, setActiveColor] = useState<string>(DRAWING_COLORS[0].value);
  const [magnetEnabled, setMagnetEnabled] = useState(false);

  const [drawingsMap, setDrawingsMap] = useState<Record<string, ChartDrawing[]>>(() =>
    loadDrawingsMap(),
  );
  const [pendingStart, setPendingStart] = useState<ChartPoint | null>(null);
  const [cursorPoint, setCursorPoint] = useState<ChartPoint | null>(null);
  const [cursorSvg, setCursorSvg] = useState<{ x: number; y: number } | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<{
    drawingId: string;
    handle: 'p1' | 'p2' | 'sl';
  } | null>(null);

  // Zoom & pan state (trailing slice)
  const [visibleCount, setVisibleCount] = useState<number>(candles.length || 100);
  const [panRightOffset, setPanRightOffset] = useState<number>(0);

  // Measure SVG container cleanly
  const svgContainerRef = useRef<HTMLDivElement | null>(null);
  const [chartDims, setChartDims] = useState({ width: 680, height: 280 });

  useEffect(() => {
    setVisibleCount((prev) => {
      if (candles.length === 0) return 0;
      if (prev <= 0 || prev > candles.length) return candles.length;
      return prev;
    });
    setPanRightOffset(0);
    setPendingStart(null);
    setSelectedDrawingId(null);
  }, [signal.symbol, signal.timeframe, candles.length]);

  useEffect(() => {
    const el = svgContainerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.max(340, Math.floor(rect.width));
      const height = isFullPage
        ? Math.max(360, Math.floor(rect.height))
        : Math.max(255, Math.min(310, Math.round(width * 0.45)));
      setChartDims((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isFullPage]);

  // Persist drawings to localStorage
  useEffect(() => {
    saveDrawingsMap(drawingsMap);
  }, [drawingsMap]);

  const currentDrawings = useMemo(
    () => drawingsMap[chartKey] ?? [],
    [drawingsMap, chartKey],
  );

  const updateCurrentDrawings = useCallback(
    (updater: (prev: ChartDrawing[]) => ChartDrawing[]) => {
      setDrawingsMap((prev) => ({
        ...prev,
        [chartKey]: updater(prev[chartKey] ?? []),
      }));
    },
    [chartKey],
  );

  // Keyboard shortcuts (Escape / Delete / Ctrl+Z)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT';
      if (isInput) return;

      if (e.key === 'Escape') {
        if (pendingStart) {
          e.stopPropagation();
          setPendingStart(null);
          return;
        }
        if (draggingHandle) {
          e.stopPropagation();
          setDraggingHandle(null);
          return;
        }
        if (activeTool !== 'crosshair') {
          e.stopPropagation();
          setActiveTool('crosshair');
          return;
        }
        if (selectedDrawingId) {
          e.stopPropagation();
          setSelectedDrawingId(null);
          return;
        }
        if (isFullPage) {
          e.stopPropagation();
          setIsFullPage(false);
          return;
        }
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId) {
        e.preventDefault();
        e.stopPropagation();
        updateCurrentDrawings((prev) => prev.filter((d) => d.id !== selectedDrawingId));
        setSelectedDrawingId(null);
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && currentDrawings.length > 0) {
        e.preventDefault();
        updateCurrentDrawings((prev) => prev.slice(0, -1));
        setSelectedDrawingId(null);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    pendingStart,
    draggingHandle,
    activeTool,
    selectedDrawingId,
    isFullPage,
    currentDrawings.length,
    updateCurrentDrawings,
  ]);

  const showAutoOverlays = analysisMode !== 'manual';
  const showManualDrawings = analysisMode !== 'auto';

  const effectiveCount =
    candles.length === 0 ? 0 : Math.max(18, Math.min(candles.length, visibleCount || candles.length));
  const maxOffset = Math.max(0, candles.length - effectiveCount);
  const clampedOffset = Math.max(0, Math.min(maxOffset, panRightOffset));
  const endIdx = candles.length - clampedOffset;
  const startIdx = Math.max(0, endIdx - effectiveCount);
  const visibleCandles = useMemo(
    () => candles.slice(startIdx, endIdx),
    [candles, startIdx, endIdx],
  );

  const candleIntervalMs = useMemo(() => {
    if (candles.length >= 2) {
      const diff = candles[candles.length - 1].timestamp - candles[candles.length - 2].timestamp;
      if (diff > 0) return diff;
    }
    return TF_DURATION_MS[signal.timeframe] ?? 60 * 60_000;
  }, [candles, signal.timeframe]);

  const width = chartDims.width;
  const height = chartDims.height;
  const padLeft = 10;
  const padRight = isFullPage ? 78 : 68;
  const padTop = 16;
  const padBottom = 26;
  const plotW = Math.max(100, width - padLeft - padRight);
  const plotH = Math.max(80, height - padTop - padBottom);
  const futureSlots = isFullPage ? 10 : 4;
  const totalSlots = Math.max(1, visibleCandles.length + futureSlots);
  const stepX = plotW / totalSlots;
  const bodyW = Math.max(2.5, Math.min(11, stepX * 0.62));

  const bounds = useMemo(() => {
    if (!visibleCandles.length) {
      return { minPrice: 0, maxPrice: 1, maxVol: 1 };
    }
    let min = Infinity;
    let max = -Infinity;
    let maxVol = 0;

    for (const c of visibleCandles) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
      if (c.volume > maxVol) maxVol = c.volume;
      if (showEmas) {
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
    }

    const isZoomed = visibleCandles.length < candles.length * 0.85;
    if (showAutoOverlays && !isZoomed) {
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
    }

    const span = Math.max(max - min, max * 0.005);
    return {
      minPrice: min - span * 0.09,
      maxPrice: max + span * 0.09,
      maxVol: Math.max(maxVol, 1),
    };
  }, [
    visibleCandles,
    candles.length,
    showEmas,
    showAutoOverlays,
    signal.entryMin,
    signal.entryMax,
    signal.smc,
    signal.direction,
    signal.stopLoss,
    signal.tp1,
  ]);

  const priceRange = Math.max(bounds.maxPrice - bounds.minPrice, 1e-9);

  const toY = useCallback(
    (price: number) => padTop + ((bounds.maxPrice - price) / priceRange) * plotH,
    [bounds.maxPrice, priceRange, plotH],
  );

  const yToPrice = useCallback(
    (y: number) => {
      const clampedY = Math.max(padTop, Math.min(padTop + plotH, y));
      return bounds.maxPrice - ((clampedY - padTop) / plotH) * priceRange;
    },
    [bounds.maxPrice, priceRange, plotH],
  );

  const timestampToX = useCallback(
    (ts: number) => {
      if (candles.length === 0) return padLeft;
      let absIdx = 0;
      if (ts <= candles[0].timestamp) {
        absIdx = (ts - candles[0].timestamp) / candleIntervalMs;
      } else if (ts >= candles[candles.length - 1].timestamp) {
        absIdx =
          candles.length - 1 + (ts - candles[candles.length - 1].timestamp) / candleIntervalMs;
      } else {
        let found = candles.length - 1;
        for (let i = 0; i < candles.length - 1; i++) {
          if (ts >= candles[i].timestamp && ts <= candles[i + 1].timestamp) {
            const span = Math.max(1, candles[i + 1].timestamp - candles[i].timestamp);
            absIdx = i + (ts - candles[i].timestamp) / span;
            found = -1;
            break;
          }
        }
        if (found !== -1) absIdx = found;
      }
      const visIdx = absIdx - startIdx;
      return padLeft + visIdx * stepX + stepX / 2;
    },
    [candles, candleIntervalMs, startIdx, stepX],
  );

  const xToPoint = useCallback(
    (svgX: number, svgY: number): { point: ChartPoint; idxInVisible: number | null } => {
      const visIdxFloat = (svgX - padLeft - stepX / 2) / stepX;
      const visIdxNearest = Math.round(visIdxFloat);
      const absIdxFloat = startIdx + visIdxFloat;

      let timestamp: number;
      if (candles.length === 0) {
        timestamp = Date.now();
      } else if (absIdxFloat <= 0) {
        timestamp = candles[0].timestamp + absIdxFloat * candleIntervalMs;
      } else if (absIdxFloat >= candles.length - 1) {
        timestamp =
          candles[candles.length - 1].timestamp +
          (absIdxFloat - (candles.length - 1)) * candleIntervalMs;
      } else {
        const i0 = Math.floor(absIdxFloat);
        const i1 = Math.min(candles.length - 1, i0 + 1);
        const frac = absIdxFloat - i0;
        timestamp =
          candles[i0].timestamp + frac * (candles[i1].timestamp - candles[i0].timestamp);
      }

      let price = yToPrice(svgY);
      const validVisIdx =
        visIdxNearest >= 0 && visIdxNearest < visibleCandles.length ? visIdxNearest : null;

      if (magnetEnabled && validVisIdx !== null) {
        const c = visibleCandles[validVisIdx];
        const ohlc = [c.open, c.high, c.low, c.close];
        let bestPrice = price;
        let bestDistPx = 14;
        for (const level of ohlc) {
          const dist = Math.abs(toY(level) - svgY);
          if (dist < bestDistPx) {
            bestDistPx = dist;
            bestPrice = level;
          }
        }
        price = bestPrice;
      }

      return {
        point: { timestamp, price },
        idxInVisible: validVisIdx,
      };
    },
    [
      candles,
      visibleCandles,
      candleIntervalMs,
      startIdx,
      stepX,
      yToPrice,
      toY,
      magnetEnabled,
    ],
  );

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * width;
    const sy = ((e.clientY - rect.top) / rect.height) * height;
    const { point, idxInVisible } = xToPoint(sx, sy);

    setCursorSvg({ x: sx, y: sy });
    setCursorPoint(point);
    setHoverIdx(idxInVisible);

    if (draggingHandle) {
      updateCurrentDrawings((prev) =>
        prev.map((d) => {
          if (d.id !== draggingHandle.drawingId) return d;
          if (draggingHandle.handle === 'p1') {
            return { ...d, p1: point };
          }
          if (draggingHandle.handle === 'p2') {
            return { ...d, p2: point };
          }
          if (draggingHandle.handle === 'sl') {
            return { ...d, slPrice: point.price };
          }
          return d;
        }),
      );
    }
  };

  const handleSvgMouseUp = () => {
    if (draggingHandle) {
      setDraggingHandle(null);
    }
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingHandle) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * width;
    const sy = ((e.clientY - rect.top) / rect.height) * height;
    const { point } = xToPoint(sx, sy);

    // Shift+Click in crosshair immediately acts as quick Measurement Ruler!
    const effectiveTool: DrawingTool =
      activeTool === 'crosshair' && e.shiftKey ? 'measure' : activeTool;

    if (effectiveTool === 'crosshair') {
      setSelectedDrawingId(null);
      return;
    }

    if (effectiveTool === 'hline') {
      const id = `drw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newDrawing: ChartDrawing = {
        id,
        tool: 'hline',
        color: activeColor,
        p1: point,
        p2: point,
        createdAt: Date.now(),
      };
      updateCurrentDrawings((prev) => [...prev, newDrawing]);
      setSelectedDrawingId(id);
      if (analysisMode === 'auto') setAnalysisMode('both');
      setActiveTool('crosshair');
      return;
    }

    if (!pendingStart) {
      setPendingStart(point);
      if (analysisMode === 'auto') setAnalysisMode('both');
      return;
    }

    // Complete 2-point drawing or measurement
    const id = `drw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let newDrawing: ChartDrawing = {
      id,
      tool: effectiveTool,
      color: activeColor,
      p1: pendingStart,
      p2: point,
      createdAt: Date.now(),
    };

    if (effectiveTool === 'long_pos' || effectiveTool === 'short_pos') {
      const levels = buildPositionLevels(effectiveTool, pendingStart, point);
      newDrawing = {
        ...newDrawing,
        p1: { timestamp: pendingStart.timestamp, price: levels.entry },
        p2: {
          timestamp:
            Math.abs(point.timestamp - pendingStart.timestamp) < candleIntervalMs * 2
              ? pendingStart.timestamp + candleIntervalMs * 10
              : point.timestamp,
          price: levels.tp,
        },
        slPrice: levels.sl,
      };
    }

    updateCurrentDrawings((prev) => [...prev, newDrawing]);
    setPendingStart(null);
    setSelectedDrawingId(id);
    if (effectiveTool !== 'measure') {
      setActiveTool('crosshair');
    }
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (!isFullPage && !e.ctrlKey) return;
    e.preventDefault();
    if (e.deltaY < 0) {
      setVisibleCount((v) => Math.max(20, Math.round((v || candles.length) * 0.85)));
    } else {
      setVisibleCount((v) => Math.min(candles.length, Math.round((v || candles.length) * 1.18)));
    }
  };

  if (!candles.length) {
    return (
      <div className="h-[270px] flex items-center justify-center border border-slate-800 rounded-lg bg-[#0B0F17] text-xs text-slate-400">
        No candle data available for {signal.symbol}
      </div>
    );
  }

  const buildEmaPath = (key: 'ema9' | 'ema21' | 'ema50') => {
    let d = '';
    visibleCandles.forEach((c, idx) => {
      const val = c[key];
      if (val === null) return;
      const x = padLeft + idx * stepX + stepX / 2;
      const y = toY(val);
      d += d === '' ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return d;
  };

  const ema9Path = showEmas ? buildEmaPath('ema9') : '';
  const ema21Path = showEmas ? buildEmaPath('ema21') : '';
  const ema50Path = showEmas ? buildEmaPath('ema50') : '';

  const tickCount = isFullPage ? 6 : 4;
  const yTicks = Array.from({ length: tickCount }, (_, i) => {
    const ratio = i / (tickCount - 1);
    const price = bounds.maxPrice - ratio * priceRange;
    return { price, y: toY(price) };
  });

  const hoveredCandle =
    hoverIdx !== null && visibleCandles[hoverIdx]
      ? visibleCandles[hoverIdx]
      : visibleCandles[visibleCandles.length - 1];

  // Combine placed drawings + live preview if mid-drawing
  const previewDrawing: ChartDrawing | null =
    pendingStart && cursorPoint && activeTool !== 'crosshair' && activeTool !== 'hline'
      ? {
          id: '__preview__',
          tool: activeTool,
          color: activeColor,
          p1: pendingStart,
          p2: cursorPoint,
          createdAt: 0,
        }
      : null;

  const renderDrawing = (d: ChartDrawing, isPreview = false) => {
    const x1 = timestampToX(d.p1.timestamp);
    const y1 = toY(d.p1.price);
    const x2 = timestampToX(d.p2.timestamp);
    const y2 = toY(d.p2.price);
    const isSelected = !isPreview && selectedDrawingId === d.id;

    const selectHandlers = isPreview
      ? {}
      : {
          onClick: (e: React.MouseEvent) => {
            if (activeTool === 'crosshair') {
              e.stopPropagation();
              setSelectedDrawingId(d.id);
            }
          },
        };

    if (d.tool === 'hline') {
      return (
        <g key={d.id} className="cursor-pointer" {...selectHandlers}>
          <line
            x1={padLeft}
            y1={y1}
            x2={width - padRight}
            y2={y1}
            stroke={d.color}
            strokeWidth={isSelected ? 2 : 1.5}
            strokeDasharray={isSelected ? undefined : '5 3'}
          />
          <rect
            x={width - padRight + 2}
            y={y1 - 8}
            width={padRight - 6}
            height={16}
            rx={2}
            fill={d.color}
          />
          <text
            x={width - padRight + 6}
            y={y1 + 3}
            fill="#090D14"
            fontSize="9.5"
            fontWeight={700}
            fontFamily="JetBrains Mono, monospace"
          >
            {formatPrice(d.p1.price)}
          </text>
          {isSelected && (
            <circle
              cx={padLeft + plotW * 0.5}
              cy={y1}
              r={5}
              fill="#0B0F17"
              stroke={d.color}
              strokeWidth={2}
              className="cursor-ns-resize"
              onMouseDown={(e) => {
                e.stopPropagation();
                setDraggingHandle({ drawingId: d.id, handle: 'p1' });
              }}
            />
          )}
        </g>
      );
    }

    if (d.tool === 'trendline') {
      return (
        <g key={d.id} className="cursor-pointer" {...selectHandlers}>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="transparent"
            strokeWidth={10}
          />
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={d.color}
            strokeWidth={isSelected ? 2.2 : 1.75}
            opacity={isPreview ? 0.8 : 1}
          />
          {(isSelected || isPreview) && (
            <>
              <circle
                cx={x1}
                cy={y1}
                r={4.5}
                fill="#0B0F17"
                stroke={d.color}
                strokeWidth={2}
                className="cursor-move"
                onMouseDown={(e) => {
                  if (isPreview) return;
                  e.stopPropagation();
                  setDraggingHandle({ drawingId: d.id, handle: 'p1' });
                }}
              />
              <circle
                cx={x2}
                cy={y2}
                r={4.5}
                fill="#0B0F17"
                stroke={d.color}
                strokeWidth={2}
                className="cursor-move"
                onMouseDown={(e) => {
                  if (isPreview) return;
                  e.stopPropagation();
                  setDraggingHandle({ drawingId: d.id, handle: 'p2' });
                }}
              />
            </>
          )}
        </g>
      );
    }

    if (d.tool === 'rect') {
      const rx = Math.min(x1, x2);
      const ry = Math.min(y1, y2);
      const rw = Math.max(4, Math.abs(x2 - x1));
      const rh = Math.max(4, Math.abs(y2 - y1));
      const highP = Math.max(d.p1.price, d.p2.price);
      const lowP = Math.min(d.p1.price, d.p2.price);

      return (
        <g key={d.id} className="cursor-pointer" {...selectHandlers}>
          <rect
            x={rx}
            y={ry}
            width={rw}
            height={rh}
            fill={d.color}
            fillOpacity={isSelected ? 0.18 : 0.12}
            stroke={d.color}
            strokeWidth={isSelected ? 1.75 : 1.25}
          />
          {rw > 56 && (
            <text
              x={rx + 5}
              y={ry + 11}
              fill={d.color}
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              Zone {formatPrice(lowP)}–{formatPrice(highP)}
            </text>
          )}
          {isSelected && (
            <>
              <circle
                cx={x1}
                cy={y1}
                r={4.5}
                fill="#0B0F17"
                stroke={d.color}
                strokeWidth={2}
                className="cursor-nwse-resize"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDraggingHandle({ drawingId: d.id, handle: 'p1' });
                }}
              />
              <circle
                cx={x2}
                cy={y2}
                r={4.5}
                fill="#0B0F17"
                stroke={d.color}
                strokeWidth={2}
                className="cursor-nwse-resize"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDraggingHandle({ drawingId: d.id, handle: 'p2' });
                }}
              />
            </>
          )}
        </g>
      );
    }

    if (d.tool === 'measure') {
      const rx = Math.min(x1, x2);
      const ry = Math.min(y1, y2);
      const rw = Math.max(2, Math.abs(x2 - x1));
      const rh = Math.max(2, Math.abs(y2 - y1));
      const diffPrice = d.p2.price - d.p1.price;
      const pct = d.p1.price > 0 ? (diffPrice / d.p1.price) * 100 : 0;
      const isUp = diffPrice >= 0;
      const accent = isUp ? '#10B981' : '#F43F5E';
      const bars = Math.max(
        1,
        Math.round(Math.abs(d.p2.timestamp - d.p1.timestamp) / candleIntervalMs),
      );
      const durStr = formatDurationMs(d.p2.timestamp - d.p1.timestamp);
      const badgeW = 148;
      const badgeH = 34;
      const badgeX = Math.max(padLeft, Math.min(width - padRight - badgeW, rx + rw / 2 - badgeW / 2));
      const badgeY = ry > padTop + 42 ? ry - badgeH - 6 : ry + rh + 6;

      return (
        <g key={d.id} className="cursor-pointer" {...selectHandlers}>
          <rect
            x={rx}
            y={ry}
            width={rw}
            height={rh}
            fill={accent}
            fillOpacity={0.14}
            stroke={accent}
            strokeWidth={isSelected ? 1.75 : 1.1}
            strokeDasharray="3 2"
          />
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={accent}
            strokeWidth={1.2}
          />
          <rect
            x={badgeX}
            y={badgeY}
            width={badgeW}
            height={badgeH}
            rx={4}
            fill="#0F1520"
            stroke={accent}
            strokeWidth={1}
          />
          <text
            x={badgeX + badgeW / 2}
            y={badgeY + 13}
            textAnchor="middle"
            fill={accent}
            fontSize="10"
            fontWeight={700}
            fontFamily="JetBrains Mono, monospace"
          >
            {isUp ? '+' : ''}
            {formatPrice(diffPrice)} ({isUp ? '+' : ''}
            {pct.toFixed(2)}%)
          </text>
          <text
            x={badgeX + badgeW / 2}
            y={badgeY + 26}
            textAnchor="middle"
            fill="#CBD5E1"
            fontSize="9"
            fontFamily="JetBrains Mono, monospace"
          >
            {bars} bars · {durStr}
          </text>
          {isSelected && (
            <>
              <circle
                cx={x1}
                cy={y1}
                r={4.5}
                fill="#0B0F17"
                stroke={accent}
                strokeWidth={2}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDraggingHandle({ drawingId: d.id, handle: 'p1' });
                }}
              />
              <circle
                cx={x2}
                cy={y2}
                r={4.5}
                fill="#0B0F17"
                stroke={accent}
                strokeWidth={2}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDraggingHandle({ drawingId: d.id, handle: 'p2' });
                }}
              />
            </>
          )}
        </g>
      );
    }

    if (d.tool === 'fib') {
      const leftX = Math.min(x1, x2);
      const rightX = Math.max(x1, x2, leftX + 70);
      const spanP = d.p2.price - d.p1.price;
      const gpTop = toY(d.p1.price + spanP * 0.5);
      const gpBot = toY(d.p1.price + spanP * 0.618);

      return (
        <g key={d.id} className="cursor-pointer" {...selectHandlers}>
          {/* Golden pocket 0.5 - 0.618 highlight */}
          <rect
            x={leftX}
            y={Math.min(gpTop, gpBot)}
            width={rightX - leftX}
            height={Math.max(2, Math.abs(gpBot - gpTop))}
            fill="#10B981"
            fillOpacity={0.09}
          />
          {/* Anchor trend diagonal */}
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#64748B"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
          {FIB_LEVELS.map((lv) => {
            const lvPrice = d.p1.price + spanP * lv.ratio;
            const lvY = toY(lvPrice);
            return (
              <g key={lv.label}>
                <line
                  x1={leftX}
                  y1={lvY}
                  x2={rightX}
                  y2={lvY}
                  stroke={lv.color}
                  strokeWidth={lv.ratio === 0.618 || lv.ratio === 0.5 ? 1.4 : 1}
                  opacity={0.85}
                />
                <text
                  x={leftX + 4}
                  y={lvY - 3}
                  fill={lv.color}
                  fontSize="9"
                  fontWeight={lv.ratio === 0.618 ? 700 : 500}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {lv.label} (${formatPrice(lvPrice)})
                </text>
              </g>
            );
          })}
          {(isSelected || isPreview) && (
            <>
              <circle
                cx={x1}
                cy={y1}
                r={4.5}
                fill="#0B0F17"
                stroke="#38BDF8"
                strokeWidth={2}
                onMouseDown={(e) => {
                  if (isPreview) return;
                  e.stopPropagation();
                  setDraggingHandle({ drawingId: d.id, handle: 'p1' });
                }}
              />
              <circle
                cx={x2}
                cy={y2}
                r={4.5}
                fill="#0B0F17"
                stroke="#38BDF8"
                strokeWidth={2}
                onMouseDown={(e) => {
                  if (isPreview) return;
                  e.stopPropagation();
                  setDraggingHandle({ drawingId: d.id, handle: 'p2' });
                }}
              />
            </>
          )}
        </g>
      );
    }

    if (d.tool === 'long_pos' || d.tool === 'short_pos') {
      const levels = buildPositionLevels(d.tool, d.p1, d.p2, d.slPrice);
      const leftX = Math.min(x1, x2);
      const rightX = Math.max(x2, leftX + 64);
      const bw = rightX - leftX;

      const yEntry = toY(levels.entry);
      const yTp = toY(levels.tp);
      const ySl = toY(levels.sl);

      const tpBoxTop = Math.min(yEntry, yTp);
      const tpBoxH = Math.max(4, Math.abs(yTp - yEntry));
      const slBoxTop = Math.min(yEntry, ySl);
      const slBoxH = Math.max(4, Math.abs(ySl - yEntry));

      const rewardAbs = Math.abs(levels.tp - levels.entry);
      const riskAbs = Math.max(Math.abs(levels.entry - levels.sl), 1e-9);
      const rr = rewardAbs / riskAbs;
      const tpPct = (rewardAbs / levels.entry) * 100;
      const slPct = (riskAbs / levels.entry) * 100;

      return (
        <g key={d.id} className="cursor-pointer" {...selectHandlers}>
          {/* Reward Box */}
          <rect
            x={leftX}
            y={tpBoxTop}
            width={bw}
            height={tpBoxH}
            fill="#10B981"
            fillOpacity={0.18}
            stroke="#10B981"
            strokeWidth={isSelected ? 1.6 : 1}
          />
          {/* Risk Box */}
          <rect
            x={leftX}
            y={slBoxTop}
            width={bw}
            height={slBoxH}
            fill="#F43F5E"
            fillOpacity={0.18}
            stroke="#F43F5E"
            strokeWidth={isSelected ? 1.6 : 1}
          />
          {/* Entry Divider Line */}
          <line
            x1={leftX}
            y1={yEntry}
            x2={rightX}
            y2={yEntry}
            stroke="#E2E8F0"
            strokeWidth={1.25}
          />

          <text
            x={leftX + 6}
            y={d.tool === 'long_pos' ? tpBoxTop + 12 : tpBoxTop + tpBoxH - 4}
            fill="#A7F3D0"
            fontSize="9.5"
            fontWeight={700}
            fontFamily="JetBrains Mono, monospace"
          >
            {d.tool === 'long_pos' ? 'LONG' : 'SHORT'} R:R 1:{rr.toFixed(2)} (+{tpPct.toFixed(2)}%)
          </text>
          <text
            x={leftX + 6}
            y={d.tool === 'long_pos' ? slBoxTop + slBoxH - 4 : slBoxTop + 12}
            fill="#FECDD3"
            fontSize="9"
            fontFamily="JetBrains Mono, monospace"
          >
            SL ${formatPrice(levels.sl)} (-{slPct.toFixed(2)}%)
          </text>

          {(isSelected || isPreview) && (
            <>
              <circle
                cx={leftX}
                cy={yEntry}
                r={4.5}
                fill="#0B0F17"
                stroke="#E2E8F0"
                strokeWidth={2}
                className="cursor-move"
                onMouseDown={(e) => {
                  if (isPreview) return;
                  e.stopPropagation();
                  setDraggingHandle({ drawingId: d.id, handle: 'p1' });
                }}
              />
              <circle
                cx={rightX}
                cy={yTp}
                r={4.5}
                fill="#0B0F17"
                stroke="#10B981"
                strokeWidth={2}
                className="cursor-ns-resize"
                onMouseDown={(e) => {
                  if (isPreview) return;
                  e.stopPropagation();
                  setDraggingHandle({ drawingId: d.id, handle: 'p2' });
                }}
              />
              <circle
                cx={rightX}
                cy={ySl}
                r={4.5}
                fill="#0B0F17"
                stroke="#F43F5E"
                strokeWidth={2}
                className="cursor-ns-resize"
                onMouseDown={(e) => {
                  if (isPreview) return;
                  e.stopPropagation();
                  setDraggingHandle({ drawingId: d.id, handle: 'sl' });
                }}
              />
            </>
          )}
        </g>
      );
    }

    return null;
  };

  const toolButtons: Array<{
    id: DrawingTool;
    label: string;
    shortLabel: string;
    renderIcon: () => React.ReactNode;
  }> = [
    {
      id: 'crosshair',
      label: 'Crosshair / Select (Esc)',
      shortLabel: 'Cursor',
      renderIcon: () => <Crosshair className="w-3.5 h-3.5" />,
    },
    {
      id: 'measure',
      label: 'Price & Bar Measurement Ruler (or Shift+Click)',
      shortLabel: 'Measure',
      renderIcon: () => <Ruler className="w-3.5 h-3.5" />,
    },
    {
      id: 'trendline',
      label: 'Trend Line',
      shortLabel: 'Trend',
      renderIcon: () => <TrendingUp className="w-3.5 h-3.5" />,
    },
    {
      id: 'hline',
      label: 'Horizontal Support / Resistance Line',
      shortLabel: 'H-Line',
      renderIcon: () => <Minus className="w-3.5 h-3.5" />,
    },
    {
      id: 'rect',
      label: 'Zone / Order Block Rectangle',
      shortLabel: 'Zone',
      renderIcon: () => <Square className="w-3.5 h-3.5" />,
    },
    {
      id: 'fib',
      label: 'Fibonacci Retracement (0–1)',
      shortLabel: 'Fib',
      renderIcon: () => (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="2" y1="3" x2="14" y2="3" />
          <line x1="2" y1="7" x2="14" y2="7" strokeDasharray="2 1.5" />
          <line x1="2" y1="10.5" x2="14" y2="10.5" />
          <line x1="2" y1="13.5" x2="14" y2="13.5" />
        </svg>
      ),
    },
    {
      id: 'long_pos',
      label: 'Long Position R:R Planner',
      shortLabel: 'Long R:R',
      renderIcon: () => <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />,
    },
    {
      id: 'short_pos',
      label: 'Short Position R:R Planner',
      shortLabel: 'Short R:R',
      renderIcon: () => <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" />,
    },
  ];

  const isLongSig = signal.direction === 'LONG';
  const isShortSig = signal.direction === 'SHORT';

  return (
    <div
      className={
        isFullPage
          ? 'fixed inset-0 z-[60] bg-[#0B0F17] flex flex-col'
          : 'border border-slate-800 rounded-lg bg-[#0B0F17] p-3 space-y-2'
      }
    >
      {/* Top Bar: OHLC Readout / Full-Page Symbol & TF / Auto vs Manual Switch / Full Page Button */}
      <div
        className={
          isFullPage
            ? 'px-4 py-2.5 bg-[#0F1520] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3'
            : 'flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80 text-xs'
        }
      >
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {isFullPage && (
            <>
              <div className="flex items-center gap-2 font-semibold text-slate-100">
                <span>{signal.baseAsset}/USDC</span>
                <span className="font-mono tabular-nums text-sky-400">
                  ${formatPrice(signal.lastPrice)}
                </span>
                <span
                  className={`font-mono tabular-nums text-[11px] ${
                    signal.priceChange24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {signal.priceChange24hPct >= 0 ? '+' : ''}
                  {signal.priceChange24hPct.toFixed(2)}%
                </span>
                <span
                  className={`font-mono text-[11px] px-1.5 py-0.5 rounded border ${
                    isLongSig
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : isShortSig
                        ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                        : 'bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  {signal.direction} {signal.confidence}%
                </span>
              </div>

              {onChangeTimeframe && (
                <div className="flex items-center gap-1 p-0.5 bg-[#0B0F17] border border-slate-800 rounded-md">
                  {ALL_TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => onChangeTimeframe(tf)}
                      className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        signal.timeframe === tf
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="flex flex-wrap items-center gap-2.5 font-mono tabular-nums text-slate-300 text-[11px]">
            <span className="text-slate-400">
              {formatCandleTime(hoveredCandle.timestamp, signal.timeframe)}
            </span>
            <span>O {formatPrice(hoveredCandle.open)}</span>
            <span>H {formatPrice(hoveredCandle.high)}</span>
            <span>L {formatPrice(hoveredCandle.low)}</span>
            <span
              className={
                hoveredCandle.close >= hoveredCandle.open ? 'text-emerald-400' : 'text-rose-400'
              }
            >
              C {formatPrice(hoveredCandle.close)}
            </span>
          </div>
        </div>

        {/* Right Controls: Auto / Manual / Both Switch + EMAs + Full Page */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            className="flex items-center gap-0.5 p-0.5 bg-[#131A26] border border-slate-800 rounded-md"
            role="group"
            aria-label="Chart Analysis Mode"
          >
            {(
              [
                { id: 'both', label: 'Auto + Manual' },
                { id: 'auto', label: 'Auto' },
                { id: 'manual', label: 'Manual' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setAnalysisMode(m.id)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  analysisMode === m.id
                    ? 'bg-sky-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowEmas((v) => !v)}
            title="Toggle EMA 9 / 21 / 50 overlays"
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showEmas
                ? 'bg-[#131A26] border-slate-700 text-slate-200'
                : 'bg-[#0B0F17] border-slate-800 text-slate-500'
            }`}
          >
            <Eye className="w-3 h-3" />
            EMAs
          </button>

          <button
            type="button"
            onClick={() => setIsFullPage((v) => !v)}
            aria-label={isFullPage ? 'Exit full page chart' : 'Open full page chart'}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isFullPage
                ? 'bg-slate-800 border-slate-600 text-slate-100 hover:bg-slate-700'
                : 'bg-[#131A26] border-slate-700 text-sky-300 hover:border-sky-500 hover:text-sky-200'
            }`}
          >
            {isFullPage ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                Exit Full Page
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                Full Page
              </>
            )}
          </button>
        </div>
      </div>

      {/* Inline Drawing & Measurement Ribbon (in compact mode, docked below header; in Full Page, left vertical TradingView rail + bottom controls) */}
      {!isFullPage && (
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1 text-[11px]">
          <div className="flex flex-wrap items-center gap-1">
            {toolButtons.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.label}
                onClick={() => {
                  setPendingStart(null);
                  setActiveTool(t.id);
                }}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTool === t.id
                    ? 'bg-sky-500/20 border-sky-500/60 text-sky-200 font-semibold'
                    : 'bg-[#131A26] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.renderIcon()}
                <span className="hidden sm:inline">{t.shortLabel}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              title="Magnet Snap to Candle OHLC"
              onClick={() => setMagnetEnabled((v) => !v)}
              className={`p-1 rounded border transition-colors cursor-pointer ${
                magnetEnabled
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-[#131A26] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Magnet className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Zoom In"
              onClick={() => setVisibleCount((v) => Math.max(20, Math.round((v || candles.length) * 0.78)))}
              className="p-1 rounded border bg-[#131A26] border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Zoom Out"
              onClick={() => setVisibleCount((v) => Math.min(candles.length, Math.round((v || candles.length) * 1.25)))}
              className="p-1 rounded border bg-[#131A26] border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            {currentDrawings.length > 0 && (
              <>
                <button
                  type="button"
                  title="Undo Last Drawing (Ctrl+Z)"
                  onClick={() => {
                    updateCurrentDrawings((prev) => prev.slice(0, -1));
                    setSelectedDrawingId(null);
                  }}
                  className="p-1 rounded border bg-[#131A26] border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Clear Drawings for This Chart"
                  onClick={() => {
                    updateCurrentDrawings(() => []);
                    setSelectedDrawingId(null);
                    setPendingStart(null);
                  }}
                  className="p-1 rounded border bg-[#131A26] border-slate-800 text-rose-400 hover:bg-rose-500/15 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Main Chart Body: Optional Left TradingView Vertical Rail (Full Page) + Chart SVG */}
      <div className={isFullPage ? 'flex-1 min-h-0 flex' : 'relative'}>
        {isFullPage && (
          <aside className="w-12 bg-[#0F1520] border-r border-slate-800 flex flex-col items-center py-2.5 gap-1.5 overflow-y-auto shrink-0">
            {toolButtons.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.label}
                onClick={() => {
                  setPendingStart(null);
                  setActiveTool(t.id);
                }}
                className={`w-8 h-8 rounded flex items-center justify-center border transition-colors cursor-pointer ${
                  activeTool === t.id
                    ? 'bg-sky-500/20 border-sky-500 text-sky-300'
                    : 'bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-100 hover:border-slate-700'
                }`}
              >
                {t.renderIcon()}
              </button>
            ))}

            <div className="w-6 h-px bg-slate-800 my-1" />

            <button
              type="button"
              title="Magnet Snap to Candle OHLC"
              onClick={() => setMagnetEnabled((v) => !v)}
              className={`w-8 h-8 rounded flex items-center justify-center border transition-colors cursor-pointer ${
                magnetEnabled
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                  : 'bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-100'
              }`}
            >
              <Magnet className="w-3.5 h-3.5" />
            </button>

            <div className="flex flex-col items-center gap-1 py-1">
              {DRAWING_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={`Color: ${c.label}`}
                  onClick={() => setActiveColor(c.value)}
                  className={`w-4 h-4 rounded-sm border cursor-pointer ${
                    activeColor === c.value ? 'border-white scale-110' : 'border-slate-700 opacity-70 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>

            <div className="w-6 h-px bg-slate-800 my-1" />

            <button
              type="button"
              title="Zoom In"
              onClick={() => setVisibleCount((v) => Math.max(20, Math.round((v || candles.length) * 0.78)))}
              className="w-8 h-8 rounded flex items-center justify-center border bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Zoom Out"
              onClick={() => setVisibleCount((v) => Math.min(candles.length, Math.round((v || candles.length) * 1.25)))}
              className="w-8 h-8 rounded flex items-center justify-center border bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Reset Zoom"
              onClick={() => {
                setVisibleCount(candles.length);
                setPanRightOffset(0);
              }}
              className="w-8 h-8 rounded flex items-center justify-center border bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Undo Last Drawing (Ctrl+Z)"
              disabled={currentDrawings.length === 0}
              onClick={() => {
                updateCurrentDrawings((prev) => prev.slice(0, -1));
                setSelectedDrawingId(null);
              }}
              className="w-8 h-8 rounded flex items-center justify-center border bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-100 disabled:opacity-35 cursor-pointer"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Clear All Manual Drawings"
              disabled={currentDrawings.length === 0}
              onClick={() => {
                updateCurrentDrawings(() => []);
                setSelectedDrawingId(null);
                setPendingStart(null);
              }}
              className="w-8 h-8 rounded flex items-center justify-center border bg-[#0B0F17] border-slate-800 text-rose-400 hover:bg-rose-500/15 disabled:opacity-35 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </aside>
        )}

        {/* Interactive SVG Canvas */}
        <div
          ref={svgContainerRef}
          className={
            isFullPage
              ? 'relative flex-1 min-w-0 min-h-0 bg-[#0B0F17]'
              : 'relative w-full'
          }
        >
          {/* Floating Contextual Prompt while placing a 2-point drawing or selecting one */}
          {(pendingStart || selectedDrawingId) && (
            <div className="absolute top-2 left-3 z-10 flex items-center gap-2 px-2.5 py-1 bg-[#0F1520]/90 border border-slate-700 rounded text-[11px] font-mono text-slate-200">
              {pendingStart ? (
                <>
                  <span className="text-sky-400">
                    Click second point for {activeTool.replace('_', ' ').toUpperCase()}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingStart(null)}
                    className="text-slate-400 hover:text-white cursor-pointer"
                  >
                    Cancel (Esc)
                  </button>
                </>
              ) : (
                <>
                  <span>Drag handles to edit</span>
                  <button
                    type="button"
                    onClick={() => {
                      updateCurrentDrawings((prev) =>
                        prev.filter((d) => d.id !== selectedDrawingId),
                      );
                      setSelectedDrawingId(null);
                    }}
                    className="text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
                  >
                    Delete (Del)
                  </button>
                </>
              )}
            </div>
          )}

          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className={`w-full block select-none ${
              activeTool === 'crosshair' ? 'cursor-crosshair' : 'cursor-cell'
            }`}
            onMouseMove={handleSvgMouseMove}
            onMouseLeave={() => {
              setHoverIdx(null);
              setCursorSvg(null);
              setCursorPoint(null);
            }}
            onMouseUp={handleSvgMouseUp}
            onClick={handleSvgClick}
            onWheel={handleWheel}
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

            {/* Right Axis Divider Line */}
            <line
              x1={width - padRight}
              y1={padTop}
              x2={width - padRight}
              y2={height - padBottom}
              stroke="#1E293B"
              strokeWidth="1"
            />

            {/* AUTO SMC Overlays (hidden in 'manual' mode) */}
            {showAutoOverlays && (
              <g>
                {signal.smc?.bullishOb && (
                  <g>
                    <rect
                      x={padLeft}
                      y={toY(signal.smc.bullishOb.high)}
                      width={plotW}
                      height={Math.max(
                        3,
                        toY(signal.smc.bullishOb.low) - toY(signal.smc.bullishOb.high),
                      )}
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

                {signal.smc?.bearishOb && (
                  <g>
                    <rect
                      x={padLeft}
                      y={toY(signal.smc.bearishOb.high)}
                      width={plotW}
                      height={Math.max(
                        3,
                        toY(signal.smc.bearishOb.low) - toY(signal.smc.bearishOb.high),
                      )}
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

                {signal.smc?.fvgZone && (
                  <rect
                    x={padLeft}
                    y={toY(signal.smc.fvgZone.high)}
                    width={plotW}
                    height={Math.max(
                      2,
                      toY(signal.smc.fvgZone.low) - toY(signal.smc.fvgZone.high),
                    )}
                    fill={signal.smc.fvgZone.type === 'BULLISH' ? '#38BDF8' : '#F59E0B'}
                    opacity="0.07"
                  />
                )}

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

                {signal.direction !== 'NEUTRAL' && (
                  <g>
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
              </g>
            )}

            {/* Bottom Volume Histogram */}
            {visibleCandles.map((c, idx) => {
              const xCenter = padLeft + idx * stepX + stepX / 2;
              const isBull = c.close >= c.open;
              const volH = Math.max(1, (c.volume / bounds.maxVol) * (plotH * 0.16));
              return (
                <rect
                  key={`vol-${c.timestamp}`}
                  x={xCenter - bodyW / 2}
                  y={height - padBottom - volH}
                  width={bodyW}
                  height={volH}
                  fill={isBull ? '#10B981' : '#EF4444'}
                  opacity="0.2"
                />
              );
            })}

            {/* Current Price Reference Line + Right Price Badge */}
            <g>
              <line
                x1={padLeft}
                y1={toY(signal.lastPrice)}
                x2={width - padRight}
                y2={toY(signal.lastPrice)}
                stroke="#38BDF8"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.65"
              />
              <rect
                x={width - padRight + 2}
                y={toY(signal.lastPrice) - 8}
                width={padRight - 6}
                height={16}
                rx={2}
                fill="#0284C7"
              />
              <text
                x={width - padRight + 6}
                y={toY(signal.lastPrice) + 3}
                fill="#F8FAFC"
                fontSize="9.5"
                fontWeight={700}
                fontFamily="JetBrains Mono, monospace"
              >
                {formatPrice(signal.lastPrice)}
              </text>
            </g>

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

            {/* Candlesticks */}
            {visibleCandles.map((c, idx) => {
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
                    strokeWidth="1.2"
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

            {/* MANUAL Drawings & Measurements (hidden only in 'auto' mode) */}
            {showManualDrawings && (
              <g>
                {currentDrawings.map((d) => renderDrawing(d, false))}
                {previewDrawing && renderDrawing(previewDrawing, true)}
              </g>
            )}

            {/* Hover Crosshair + Price/Time Axis Labels */}
            {cursorSvg && cursorSvg.x >= padLeft && cursorSvg.x <= width - padRight && (
              <g pointerEvents="none">
                <line
                  x1={
                    hoverIdx !== null
                      ? padLeft + hoverIdx * stepX + stepX / 2
                      : cursorSvg.x
                  }
                  y1={padTop}
                  x2={
                    hoverIdx !== null
                      ? padLeft + hoverIdx * stepX + stepX / 2
                      : cursorSvg.x
                  }
                  y2={height - padBottom}
                  stroke="#475569"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                {cursorPoint && (
                  <>
                    <line
                      x1={padLeft}
                      y1={toY(cursorPoint.price)}
                      x2={width - padRight}
                      y2={toY(cursorPoint.price)}
                      stroke="#475569"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    <rect
                      x={width - padRight + 2}
                      y={toY(cursorPoint.price) - 8}
                      width={padRight - 6}
                      height={16}
                      rx={2}
                      fill="#334155"
                    />
                    <text
                      x={width - padRight + 6}
                      y={toY(cursorPoint.price) + 3}
                      fill="#F8FAFC"
                      fontSize="9.5"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {formatPrice(cursorPoint.price)}
                    </text>
                  </>
                )}
              </g>
            )}

            {/* X-Axis Timestamps */}
            {[
              0,
              Math.floor(visibleCandles.length * 0.33),
              Math.floor(visibleCandles.length * 0.66),
              visibleCandles.length - 1,
            ].map((idx, i) => {
              const c = visibleCandles[idx];
              if (!c) return null;
              const x = padLeft + idx * stepX + stepX / 2;
              return (
                <text
                  key={`${idx}-${i}`}
                  x={x}
                  y={height - 6}
                  textAnchor={i === 0 ? 'start' : 'middle'}
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
      </div>

      {/* Footer Info Strip in Full Page Mode */}
      {isFullPage && (
        <div className="px-4 py-1.5 bg-[#0F1520] border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Mode:{' '}
              <strong className="text-slate-200">
                {analysisMode === 'both'
                  ? 'Auto SMC + Manual Drawings'
                  : analysisMode === 'auto'
                    ? 'Auto SMC Only'
                    : 'Manual Price Action Only'}
              </strong>
            </span>
            <span className="text-slate-600">·</span>
            <span>Drawings saved on chart: {currentDrawings.length}</span>
            <span className="text-slate-600">·</span>
            <span>Shift+Click for quick Measurement Ruler · Wheel to zoom</span>
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px]">
            {signal.smc?.bullishOb && showAutoOverlays && (
              <span className="text-emerald-400">
                Bullish OB ${formatPrice(signal.smc.bullishOb.low)}–${formatPrice(signal.smc.bullishOb.high)}
              </span>
            )}
            {signal.smc?.bearishOb && showAutoOverlays && (
              <span className="text-rose-400">
                Bearish OB ${formatPrice(signal.smc.bearishOb.low)}–${formatPrice(signal.smc.bearishOb.high)}
              </span>
            )}
            <span className="text-sky-400">EMA9</span>
            <span className="text-amber-400">EMA21</span>
            <span className="text-slate-300">EMA50</span>
          </div>
        </div>
      )}
    </div>
  );
};
