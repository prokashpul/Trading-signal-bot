import type { Candle } from './types.ts';

export function computeEMASeries(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) {
    return result;
  }

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let prevEma = sum / period;
  result[period - 1] = prevEma;

  const multiplier = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prevEma = (values[i] - prevEma) * multiplier + prevEma;
    result[i] = prevEma;
  }

  return result;
}

export function computeRSISeries(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) {
    return result;
  }

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      gainSum += diff;
    } else {
      lossSum += Math.abs(diff);
    }
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }

  return result;
}

export function computeMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): {
  macdLine: number;
  signalLine: number;
  histogram: number;
  prevHistogram: number;
} {
  const fastEma = computeEMASeries(closes, fastPeriod);
  const slowEma = computeEMASeries(closes, slowPeriod);

  const macdValues: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const f = fastEma[i];
    const s = slowEma[i];
    if (f !== null && s !== null) {
      macdValues.push(f - s);
    }
  }

  if (macdValues.length < signalPeriod + 1) {
    const lastMacd = macdValues[macdValues.length - 1] ?? 0;
    return {
      macdLine: lastMacd,
      signalLine: lastMacd,
      histogram: 0,
      prevHistogram: 0,
    };
  }

  const signalEma = computeEMASeries(macdValues, signalPeriod);
  const lastIdx = macdValues.length - 1;
  const prevIdx = lastIdx - 1;

  const macdLine = macdValues[lastIdx];
  const signalLine = signalEma[lastIdx] ?? macdLine;
  const histogram = macdLine - signalLine;

  const prevMacd = macdValues[prevIdx];
  const prevSignal = signalEma[prevIdx] ?? prevMacd;
  const prevHistogram = prevMacd - prevSignal;

  return {
    macdLine,
    signalLine,
    histogram,
    prevHistogram,
  };
}

export function computeBollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2,
): {
  upper: number;
  middle: number;
  lower: number;
  percentB: number;
} {
  if (closes.length < period) {
    const last = closes[closes.length - 1] ?? 0;
    return { upper: last, middle: last, lower: last, percentB: 0.5 };
  }

  const slice = closes.slice(-period);
  const middle = slice.reduce((acc, v) => acc + v, 0) / period;
  const variance = slice.reduce((acc, v) => acc + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = middle + stdDevMultiplier * stdDev;
  const lower = middle - stdDevMultiplier * stdDev;
  const last = closes[closes.length - 1];
  const bandRange = upper - lower;
  const percentB = bandRange > 0 ? (last - lower) / bandRange : 0.5;

  return { upper, middle, lower, percentB };
}

export function computeATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) {
    return candles[0] ? candles[0].high - candles[0].low : 0;
  }

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prevClose),
      Math.abs(curr.low - prevClose),
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) {
    return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
  }

  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

export function computeVolumeRatio(candles: Candle[], lookback = 20): number {
  if (candles.length < 3) {
    return 1;
  }
  // Compare latest completed or near-completed candle volume against trailing 20-candle average
  const lastClosedIdx = candles.length - 2;
  const startIdx = Math.max(0, lastClosedIdx - lookback);
  const baselineSlice = candles.slice(startIdx, lastClosedIdx);
  if (baselineSlice.length === 0) {
    return 1;
  }
  const avgVol = baselineSlice.reduce((sum, c) => sum + c.volume, 0) / baselineSlice.length;
  if (avgVol <= 0) {
    return 1;
  }
  // Use the higher of active candle or last closed candle if active candle already exceeds avg
  const currentVol = candles[candles.length - 1].volume;
  const prevVol = candles[lastClosedIdx].volume;
  const effectiveVol = currentVol > prevVol ? currentVol : prevVol;
  return effectiveVol / avgVol;
}

export function computeSwingLevels(
  candles: Candle[],
  lookback = 24,
): { swingHigh: number; swingLow: number } {
  const slice = candles.slice(-lookback);
  let swingHigh = -Infinity;
  let swingLow = Infinity;
  for (const c of slice) {
    if (c.high > swingHigh) swingHigh = c.high;
    if (c.low < swingLow) swingLow = c.low;
  }
  return {
    swingHigh: Number.isFinite(swingHigh) ? swingHigh : 0,
    swingLow: Number.isFinite(swingLow) ? swingLow : 0,
  };
}

export interface RawSmcZones {
  bullishOb: { low: number; high: number } | null;
  bearishOb: { low: number; high: number } | null;
  bullishFvg: { low: number; high: number } | null;
  bearishFvg: { low: number; high: number } | null;
  sslSwept: boolean;
  bslSwept: boolean;
  sweptSslLevel: number | null;
  sweptBslLevel: number | null;
  nearestBslPool: number | null;
  nearestSslPool: number | null;
  bosDirection: 'BULLISH_BOS' | 'BEARISH_BOS' | 'NONE';
  bullRejection: boolean;
  bearRejection: boolean;
}

export function computeSmartMoneyZones(
  candles: Candle[],
  atr14: number,
  lastPrice: number,
): RawSmcZones {
  const empty: RawSmcZones = {
    bullishOb: null,
    bearishOb: null,
    bullishFvg: null,
    bearishFvg: null,
    sslSwept: false,
    bslSwept: false,
    sweptSslLevel: null,
    sweptBslLevel: null,
    nearestBslPool: null,
    nearestSslPool: null,
    bosDirection: 'NONE',
    bullRejection: false,
    bearRejection: false,
  };

  if (candles.length < 20 || lastPrice <= 0) {
    return empty;
  }

  const effectiveAtr = Math.max(atr14, lastPrice * 0.003);
  const startWindow = Math.max(2, candles.length - 75);

  // 1. Fractal Pivot Highs & Lows (Liquidity Pools)
  const pivotHighs: Array<{ idx: number; price: number }> = [];
  const pivotLows: Array<{ idx: number; price: number }> = [];

  for (let i = startWindow; i <= candles.length - 3; i++) {
    const c = candles[i];
    if (
      c.high > candles[i - 1].high &&
      c.high > candles[i - 2].high &&
      c.high >= candles[i + 1].high &&
      c.high >= candles[i + 2].high
    ) {
      pivotHighs.push({ idx: i, price: c.high });
    }
    if (
      c.low < candles[i - 1].low &&
      c.low < candles[i - 2].low &&
      c.low <= candles[i + 1].low &&
      c.low <= candles[i + 2].low
    ) {
      pivotLows.push({ idx: i, price: c.low });
    }
  }

  const bslCandidates = pivotHighs
    .map((p) => p.price)
    .filter((p) => p > lastPrice * 1.001)
    .sort((a, b) => a - b);
  const sslCandidates = pivotLows
    .map((p) => p.price)
    .filter((p) => p < lastPrice * 0.999)
    .sort((a, b) => b - a);

  const nearestBslPool = bslCandidates.length > 0 ? bslCandidates[0] : null;
  const nearestSslPool = sslCandidates.length > 0 ? sslCandidates[0] : null;

  // 2. Liquidity Sweep Detection in the last 5 candles (Stop Hunt -> Reclaim)
  let sslSwept = false;
  let sweptSslLevel: number | null = null;
  let bslSwept = false;
  let sweptBslLevel: number | null = null;

  const recentStart = Math.max(startWindow, candles.length - 5);
  for (let r = recentStart; r < candles.length; r++) {
    const rc = candles[r];
    for (const pl of pivotLows) {
      if (pl.idx >= r - 2) continue;
      if (rc.low < pl.price * 0.9995 && rc.close > pl.price * 0.9995 && lastPrice >= pl.price * 0.998) {
        sslSwept = true;
        sweptSslLevel = pl.price;
      }
    }
    for (const ph of pivotHighs) {
      if (ph.idx >= r - 2) continue;
      if (rc.high > ph.price * 1.0005 && rc.close < ph.price * 1.0005 && lastPrice <= ph.price * 1.002) {
        bslSwept = true;
        sweptBslLevel = ph.price;
      }
    }
  }

  // 3. Average Candle Body for Displacement / Order Block Detection
  const bodySlice = candles.slice(-40);
  const avgBody =
    bodySlice.reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) /
    Math.max(1, bodySlice.length);

  // 4. Unmitigated Bullish & Bearish Order Blocks (last 55 candles)
  let bullishOb: { low: number; high: number } | null = null;
  let bearishOb: { low: number; high: number } | null = null;

  for (let i = candles.length - 3; i >= Math.max(4, candles.length - 55); i--) {
    const obCandle = candles[i];
    const next1 = candles[i + 1];
    const next2 = candles[i + 2];

    // Bullish Order Block: last bearish candle before strong upward displacement + local high break
    if (!bullishOb && obCandle.close <= obCandle.open) {
      const dispMove = Math.max(next1.close, next2.close) - obCandle.low;
      const impulseBody = Math.max(next1.close - next1.open, next2.close - obCandle.open);
      const localPrevHigh = Math.max(
        candles[i - 1].high,
        candles[i - 2].high,
        candles[i - 3].high,
      );
      const brokeLocalHigh = Math.max(next1.close, next2.close) > localPrevHigh;

      if (
        (dispMove >= effectiveAtr * 1.35 || impulseBody >= Math.max(effectiveAtr * 0.95, avgBody * 1.9)) &&
        brokeLocalHigh
      ) {
        const obLow = obCandle.low;
        const obHigh = Math.min(
          obCandle.high,
          Math.max(obCandle.open, obCandle.low + effectiveAtr * 1.35),
        );
        if (obHigh > obLow && obLow <= lastPrice * 1.008) {
          // Verify OB wasn't decisively invalidated by a prior candle close below obLow
          let invalidated = false;
          for (let m = i + 2; m < candles.length - 1; m++) {
            if (candles[m].close < obLow * 0.995) {
              invalidated = true;
              break;
            }
          }
          if (!invalidated) {
            bullishOb = { low: obLow, high: obHigh };
          }
        }
      }
    }

    // Bearish Order Block: last bullish candle before strong downward displacement + local low break
    if (!bearishOb && obCandle.close >= obCandle.open) {
      const dispMove = obCandle.high - Math.min(next1.close, next2.close);
      const impulseBody = Math.max(next1.open - next1.close, obCandle.open - next2.close);
      const localPrevLow = Math.min(
        candles[i - 1].low,
        candles[i - 2].low,
        candles[i - 3].low,
      );
      const brokeLocalLow = Math.min(next1.close, next2.close) < localPrevLow;

      if (
        (dispMove >= effectiveAtr * 1.35 || impulseBody >= Math.max(effectiveAtr * 0.95, avgBody * 1.9)) &&
        brokeLocalLow
      ) {
        const obHigh = obCandle.high;
        const obLow = Math.max(
          obCandle.low,
          Math.min(obCandle.open, obCandle.high - effectiveAtr * 1.35),
        );
        if (obHigh > obLow && obHigh >= lastPrice * 0.992) {
          let invalidated = false;
          for (let m = i + 2; m < candles.length - 1; m++) {
            if (candles[m].close > obHigh * 1.005) {
              invalidated = true;
              break;
            }
          }
          if (!invalidated) {
            bearishOb = { low: obLow, high: obHigh };
          }
        }
      }
    }

    if (bullishOb && bearishOb) break;
  }

  // 5. Unmitigated Fair Value Gaps (FVG) in trailing 32 candles
  let bullishFvg: { low: number; high: number } | null = null;
  let bearishFvg: { low: number; high: number } | null = null;
  const minFvgSize = Math.max(effectiveAtr * 0.14, lastPrice * 0.0008);

  for (let i = candles.length - 2; i >= Math.max(2, candles.length - 32); i--) {
    if (!bullishFvg && candles[i].low - candles[i - 2].high >= minFvgSize) {
      const low = candles[i - 2].high;
      const high = candles[i].low;
      let filled = false;
      for (let m = i + 1; m < candles.length - 1; m++) {
        if (candles[m].close < low * 0.997) {
          filled = true;
          break;
        }
      }
      if (!filled && low <= lastPrice * 1.006) {
        bullishFvg = { low, high };
      }
    }

    if (!bearishFvg && candles[i - 2].low - candles[i].high >= minFvgSize) {
      const low = candles[i].high;
      const high = candles[i - 2].low;
      let filled = false;
      for (let m = i + 1; m < candles.length - 1; m++) {
        if (candles[m].close > high * 1.003) {
          filled = true;
          break;
        }
      }
      if (!filled && high >= lastPrice * 0.994) {
        bearishFvg = { low, high };
      }
    }

    if (bullishFvg && bearishFvg) break;
  }

  // 6. Break of Structure (BOS)
  let bosDirection: 'BULLISH_BOS' | 'BEARISH_BOS' | 'NONE' = 'NONE';
  const priorHigh = pivotHighs.length > 0 ? pivotHighs[pivotHighs.length - 1].price : null;
  const priorLow = pivotLows.length > 0 ? pivotLows[pivotLows.length - 1].price : null;
  const recentHighClose = Math.max(...candles.slice(-8).map((c) => c.close));
  const recentLowClose = Math.min(...candles.slice(-8).map((c) => c.close));

  if (priorHigh !== null && recentHighClose > priorHigh && (priorLow === null || lastPrice > priorLow)) {
    bosDirection = 'BULLISH_BOS';
  } else if (priorLow !== null && recentLowClose < priorLow && (priorHigh === null || lastPrice < priorHigh)) {
    bosDirection = 'BEARISH_BOS';
  }

  // 7. Entry Rejection / Displacement Candle Confirmation
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const lastRange = Math.max(last.high - last.low, 1e-12);
  const lowerWickRatio = (Math.min(last.open, last.close) - last.low) / lastRange;
  const upperWickRatio = (last.high - Math.max(last.open, last.close)) / lastRange;

  const bullRejection =
    lowerWickRatio >= 0.3 ||
    (last.close > last.open && (last.close - last.low) / lastRange >= 0.62) ||
    (last.close > last.open && last.close > prev.high);

  const bearRejection =
    upperWickRatio >= 0.3 ||
    (last.close < last.open && (last.high - last.close) / lastRange >= 0.62) ||
    (last.close < last.open && last.close < prev.low);

  return {
    bullishOb,
    bearishOb,
    bullishFvg,
    bearishFvg,
    sslSwept,
    bslSwept,
    sweptSslLevel,
    sweptBslLevel,
    nearestBslPool,
    nearestSslPool,
    bosDirection,
    bullRejection,
    bearRejection,
  };
}
