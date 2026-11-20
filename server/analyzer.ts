import {
  computeATR,
  computeBollingerBands,
  computeEMASeries,
  computeMACD,
  computeRSISeries,
  computeSmartMoneyZones,
  computeSwingLevels,
  computeVolumeRatio,
} from './indicators.ts';
import type {
  ChartCandle,
  FuturesSignal,
  MarketSnapshot,
  SignalDirection,
  SmcAnalysis,
  Timeframe,
  TradeMode,
  TradeStyle,
} from './types.ts';

function roundToPrecision(value: number, referencePrice: number): number {
  if (!Number.isFinite(value) || value <= 0) return value;
  if (referencePrice >= 1000) return Number(value.toFixed(2));
  if (referencePrice >= 100) return Number(value.toFixed(2));
  if (referencePrice >= 10) return Number(value.toFixed(3));
  if (referencePrice >= 1) return Number(value.toFixed(4));
  if (referencePrice >= 0.01) return Number(value.toFixed(5));
  return Number(value.toFixed(8));
}

export function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return '0';
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 10) return price.toFixed(3);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(8);
}

export function resolveTradeStyle(timeframe: Timeframe, tradeMode: TradeMode): TradeStyle {
  if (tradeMode !== 'auto') {
    return tradeMode;
  }
  if (timeframe === '1d' || timeframe === '4h') return 'swing';
  if (timeframe === '1h' || timeframe === '30m') return 'intraday';
  return 'scalp';
}

export function analyzeMarketSnapshot(
  snapshot: MarketSnapshot,
  timeframe: Timeframe,
  tradeMode: TradeMode = 'swing',
  strongEntryOnly = true,
): FuturesSignal {
  const tradeStyle = resolveTradeStyle(timeframe, tradeMode);
  const isSwing = tradeStyle === 'swing';
  const isScalp = tradeStyle === 'scalp';

  const {
    candles,
    lastPrice,
    symbol,
    exchangeUsed,
    priceChange24hPct,
    quoteVolume24h,
    fundingRatePct,
    openInterestUsd,
    bestBid,
    bestAsk,
  } = snapshot;
  const closes = candles.map((c) => c.close);
  const lastCandle = candles[candles.length - 1];

  const ema9Series = computeEMASeries(closes, 9);
  const ema21Series = computeEMASeries(closes, 21);
  const ema50Series = computeEMASeries(closes, 50);
  const ema200Series = computeEMASeries(closes, 200);
  const rsiSeries = computeRSISeries(closes, 14);

  const idx = closes.length - 1;
  const ema9 = ema9Series[idx] ?? lastPrice;
  const ema21 = ema21Series[idx] ?? lastPrice;
  const ema50 = ema50Series[idx] ?? lastPrice;
  const ema200 = ema200Series[idx];

  const prevEma9 = ema9Series[idx - 1] ?? ema9;
  const prevEma21 = ema21Series[idx - 1] ?? ema21;

  const rsi14 = rsiSeries[idx] ?? 50;
  const prevRsi14 = rsiSeries[idx - 1] ?? rsi14;

  const macd = computeMACD(closes, 12, 26, 9);
  const bb = computeBollingerBands(closes, 20, 2);
  const atr14 = computeATR(candles, 14);
  const atrPct = lastPrice > 0 ? (atr14 / lastPrice) * 100 : 1.5;
  const effectiveAtr = Math.max(atr14, lastPrice * 0.004);
  const volumeRatio = computeVolumeRatio(candles, 20);
  const swingLookback = isSwing ? 36 : isScalp ? 16 : 24;
  const { swingHigh, swingLow } = computeSwingLevels(candles, swingLookback);

  // Smart Money Concepts: Liquidity Sweeps, Order Blocks, FVG, BOS, Rejection
  const rawSmc = computeSmartMoneyZones(candles, atr14, lastPrice);

  let bullScore = 0;
  let bearScore = 0;
  const bullReasons: string[] = [];
  const bearReasons: string[] = [];

  // Pillar 1: EMA Ribbon Structure (22 pts)
  const bullEmaAligned = ema9 > ema21 && ema21 > ema50 && lastPrice >= ema50 * 0.994;
  const bearEmaAligned = ema9 < ema21 && ema21 < ema50 && lastPrice <= ema50 * 1.006;

  if (bullEmaAligned) {
    bullScore += 22;
    bullReasons.push(`Bullish EMA ribbon aligned (EMA9 > EMA21 > EMA50)`);
  } else if (ema9 > ema21) {
    bullScore += 10;
    bullReasons.push(`Short-term EMA9 > EMA21 structure`);
  }

  if (bearEmaAligned) {
    bearScore += 22;
    bearReasons.push(`Bearish EMA ribbon aligned (EMA9 < EMA21 < EMA50)`);
  } else if (ema9 < ema21) {
    bearScore += 10;
    bearReasons.push(`Short-term EMA9 < EMA21 structure`);
  }

  if (prevEma9 <= prevEma21 && ema9 > ema21) bullScore += 3;
  else if (prevEma9 >= prevEma21 && ema9 < ema21) bearScore += 3;

  // Pillar 2: Macro Trend Alignment (EMA200 / EMA50, 10 pts)
  let bullMacroAligned = false;
  let bearMacroAligned = false;

  if (ema200 !== null) {
    if (lastPrice > ema200 && ema50 > ema200) {
      bullMacroAligned = true;
      bullScore += 10;
      bullReasons.push(`Macro uptrend above EMA200 ($${formatPrice(ema200)})`);
    } else if (lastPrice > ema200) {
      bullMacroAligned = true;
      bullScore += 8;
      bullReasons.push(`Holding above macro EMA200 ($${formatPrice(ema200)})`);
    }

    if (lastPrice < ema200 && ema50 < ema200) {
      bearMacroAligned = true;
      bearScore += 10;
      bearReasons.push(`Macro downtrend below EMA200 ($${formatPrice(ema200)})`);
    } else if (lastPrice < ema200) {
      bearMacroAligned = true;
      bearScore += 8;
      bearReasons.push(`Trading below macro EMA200 ($${formatPrice(ema200)})`);
    }
  } else {
    if (lastPrice > ema50) {
      bullMacroAligned = true;
      bullScore += 9;
      bullReasons.push(`Above trend EMA50 ($${formatPrice(ema50)})`);
    } else if (lastPrice < ema50) {
      bearMacroAligned = true;
      bearScore += 9;
      bearReasons.push(`Below trend EMA50 ($${formatPrice(ema50)})`);
    }
  }

  // Pillar 3: RSI(14) Trend Momentum Sweet Spot (14 pts)
  const bullRsiStrong = rsi14 >= 44 && rsi14 <= 72 && rsi14 >= prevRsi14 - 1.5;
  const bearRsiStrong = rsi14 <= 56 && rsi14 >= 28 && rsi14 <= prevRsi14 + 1.5;

  if (bullRsiStrong) {
    bullScore += 14;
    bullReasons.push(`RSI(14) at ${rsi14.toFixed(1)} supporting upward expansion`);
  } else if (rsi14 > 75) {
    bearScore += 5;
  }

  if (bearRsiStrong) {
    bearScore += 14;
    bearReasons.push(`RSI(14) at ${rsi14.toFixed(1)} supporting downward continuation`);
  } else if (rsi14 < 25) {
    bullScore += 5;
  }

  // Pillar 4: MACD Momentum Confirmation (14 pts)
  const bullMacdStrong =
    macd.macdLine > macd.signalLine &&
    (macd.histogram > 0 || macd.histogram > macd.prevHistogram);
  const bearMacdStrong =
    macd.macdLine < macd.signalLine &&
    (macd.histogram < 0 || macd.histogram < macd.prevHistogram);

  if (bullMacdStrong) {
    bullScore += macd.histogram > macd.prevHistogram ? 14 : 11;
    bullReasons.push('MACD bullish momentum turning positive');
  } else if (macd.histogram > 0) {
    bullScore += 6;
  }

  if (bearMacdStrong) {
    bearScore += macd.histogram < macd.prevHistogram ? 14 : 11;
    bearReasons.push('MACD bearish momentum expanding lower');
  } else if (macd.histogram < 0) {
    bearScore += 6;
  }

  // Pillar 5: Bollinger Channel + Candle Structure (10 pts)
  const bullStructureStrong = bb.percentB >= 0.32 && bb.percentB <= 0.92;
  const bearStructureStrong = bb.percentB <= 0.68 && bb.percentB >= 0.08;
  const candleBullOk = lastCandle ? lastCandle.close >= lastCandle.open * 0.996 || rawSmc.bullRejection : true;
  const candleBearOk = lastCandle ? lastCandle.close <= lastCandle.open * 1.004 || rawSmc.bearRejection : true;

  if (bullStructureStrong) {
    bullScore += candleBullOk ? 10 : 6;
  }
  if (bearStructureStrong) {
    bearScore += candleBearOk ? 10 : 6;
  }

  // Pillar 6: Institutional Volume Confirmation (8 pts)
  const volOk = volumeRatio >= 0.9;
  if (volumeRatio >= 1.45) {
    if (bullScore >= bearScore) {
      bullScore += 8;
      bullReasons.push(`Institutional volume spike (${volumeRatio.toFixed(2)}x avg)`);
    } else {
      bearScore += 8;
      bearReasons.push(`Heavy sell volume spike (${volumeRatio.toFixed(2)}x avg)`);
    }
  } else if (volumeRatio >= 1.05) {
    if (bullScore >= bearScore) bullScore += 6;
    else bearScore += 6;
  } else if (volumeRatio >= 0.9) {
    if (bullScore >= bearScore) bullScore += 3;
    else bearScore += 3;
  }

  // --- Institutional Entry Zone Derivation (Order Block + FVG + Liquidity) ---
  const zonePad = Math.min(effectiveAtr * 0.35, lastPrice * 0.004);
  const candleLow = lastCandle ? lastCandle.low : lastPrice;
  const candleHigh = lastCandle ? lastCandle.high : lastPrice;

  // Ideal Bullish Entry Zone
  let bullZoneLow: number;
  let bullZoneHigh: number;
  let bullZoneLabel: string;

  if (rawSmc.bullishOb && rawSmc.bullishFvg) {
    // Intersect or blend Bullish OB with FVG if close, otherwise prefer higher-probability zone closest to price
    const overlaps =
      rawSmc.bullishOb.high >= rawSmc.bullishFvg.low * 0.995 &&
      rawSmc.bullishOb.low <= rawSmc.bullishFvg.high * 1.005;
    if (overlaps) {
      bullZoneLow = Math.min(rawSmc.bullishOb.low, rawSmc.bullishFvg.low);
      bullZoneHigh = Math.max(rawSmc.bullishOb.high, rawSmc.bullishFvg.high);
      bullZoneLabel = rawSmc.sslSwept ? 'Bullish OB + FVG + SSL Sweep' : 'Bullish OB + FVG Confluence';
    } else if (lastPrice - rawSmc.bullishFvg.high < lastPrice - rawSmc.bullishOb.high) {
      bullZoneLow = rawSmc.bullishFvg.low;
      bullZoneHigh = rawSmc.bullishFvg.high;
      bullZoneLabel = rawSmc.sslSwept ? 'Bullish FVG + SSL Sweep' : 'Bullish FVG Retest Zone';
    } else {
      bullZoneLow = rawSmc.bullishOb.low;
      bullZoneHigh = rawSmc.bullishOb.high;
      bullZoneLabel = rawSmc.sslSwept ? 'Bullish Order Block + SSL Sweep' : 'Bullish Order Block (Demand)';
    }
  } else if (rawSmc.bullishOb) {
    bullZoneLow = rawSmc.bullishOb.low;
    bullZoneHigh = rawSmc.bullishOb.high;
    bullZoneLabel = rawSmc.sslSwept ? 'Bullish Order Block + SSL Sweep' : 'Bullish Order Block (Demand)';
  } else if (rawSmc.bullishFvg) {
    bullZoneLow = rawSmc.bullishFvg.low;
    bullZoneHigh = rawSmc.bullishFvg.high;
    bullZoneLabel = rawSmc.sslSwept ? 'Bullish FVG + SSL Sweep' : 'Bullish FVG Imbalance';
  } else if (rawSmc.sslSwept && rawSmc.sweptSslLevel) {
    bullZoneLow = rawSmc.sweptSslLevel * 0.998;
    bullZoneHigh = Math.max(rawSmc.sweptSslLevel + effectiveAtr * 0.35, Math.min(ema21, lastPrice) + effectiveAtr * 0.2);
    bullZoneLabel = 'Sell-Side Liquidity (SSL) Reclaim';
  } else {
    const anchor = Math.min(ema21, swingLow + effectiveAtr * 0.65);
    bullZoneLow = anchor - effectiveAtr * 0.35;
    bullZoneHigh = anchor + effectiveAtr * 0.25;
    bullZoneLabel = 'EMA21 / Demand Pullback Zone';
  }

  // Ideal Bearish Entry Zone
  let bearZoneLow: number;
  let bearZoneHigh: number;
  let bearZoneLabel: string;

  if (rawSmc.bearishOb && rawSmc.bearishFvg) {
    const overlaps =
      rawSmc.bearishOb.high >= rawSmc.bearishFvg.low * 0.995 &&
      rawSmc.bearishOb.low <= rawSmc.bearishFvg.high * 1.005;
    if (overlaps) {
      bearZoneLow = Math.min(rawSmc.bearishOb.low, rawSmc.bearishFvg.low);
      bearZoneHigh = Math.max(rawSmc.bearishOb.high, rawSmc.bearishFvg.high);
      bearZoneLabel = rawSmc.bslSwept ? 'Bearish OB + FVG + BSL Sweep' : 'Bearish OB + FVG Confluence';
    } else if (rawSmc.bearishFvg.low - lastPrice < rawSmc.bearishOb.low - lastPrice) {
      bearZoneLow = rawSmc.bearishFvg.low;
      bearZoneHigh = rawSmc.bearishFvg.high;
      bearZoneLabel = rawSmc.bslSwept ? 'Bearish FVG + BSL Sweep' : 'Bearish FVG Retest Zone';
    } else {
      bearZoneLow = rawSmc.bearishOb.low;
      bearZoneHigh = rawSmc.bearishOb.high;
      bearZoneLabel = rawSmc.bslSwept ? 'Bearish Order Block + BSL Sweep' : 'Bearish Order Block (Supply)';
    }
  } else if (rawSmc.bearishOb) {
    bearZoneLow = rawSmc.bearishOb.low;
    bearZoneHigh = rawSmc.bearishOb.high;
    bearZoneLabel = rawSmc.bslSwept ? 'Bearish Order Block + BSL Sweep' : 'Bearish Order Block (Supply)';
  } else if (rawSmc.bearishFvg) {
    bearZoneLow = rawSmc.bearishFvg.low;
    bearZoneHigh = rawSmc.bearishFvg.high;
    bearZoneLabel = rawSmc.bslSwept ? 'Bearish FVG + BSL Sweep' : 'Bearish FVG Imbalance';
  } else if (rawSmc.bslSwept && rawSmc.sweptBslLevel) {
    bearZoneLow = Math.min(rawSmc.sweptBslLevel - effectiveAtr * 0.35, Math.max(ema21, lastPrice) - effectiveAtr * 0.2);
    bearZoneHigh = rawSmc.sweptBslLevel * 1.002;
    bearZoneLabel = 'Buy-Side Liquidity (BSL) Reclaim';
  } else {
    const anchor = Math.max(ema21, swingHigh - effectiveAtr * 0.65);
    bearZoneLow = anchor - effectiveAtr * 0.25;
    bearZoneHigh = anchor + effectiveAtr * 0.35;
    bearZoneLabel = 'EMA21 / Supply Pullback Zone';
  }

  // Exact Zone Tap & Anti-Chase Gate
  const tappedBullZone =
    candleLow <= bullZoneHigh + zonePad &&
    lastPrice >= bullZoneLow - zonePad &&
    lastPrice <= bullZoneHigh + zonePad * 1.25;
  const bullNotChasing = lastPrice <= ema21 + effectiveAtr * 1.2;
  const hasBullSmcCatalyst =
    Boolean(rawSmc.bullishOb && candleLow <= rawSmc.bullishOb.high + zonePad && lastPrice >= rawSmc.bullishOb.low - zonePad) ||
    Boolean(rawSmc.bullishFvg && candleLow <= rawSmc.bullishFvg.high + zonePad && lastPrice >= rawSmc.bullishFvg.low - zonePad) ||
    rawSmc.sslSwept;

  const bullInPerfectZone =
    tappedBullZone &&
    bullNotChasing &&
    (hasBullSmcCatalyst || (rawSmc.bullRejection && rawSmc.bosDirection === 'BULLISH_BOS'));

  const tappedBearZone =
    candleHigh >= bearZoneLow - zonePad &&
    lastPrice <= bearZoneHigh + zonePad &&
    lastPrice >= bearZoneLow - zonePad * 1.25;
  const bearNotChasing = lastPrice >= ema21 - effectiveAtr * 1.2;
  const hasBearSmcCatalyst =
    Boolean(rawSmc.bearishOb && candleHigh >= rawSmc.bearishOb.low - zonePad && lastPrice <= rawSmc.bearishOb.high + zonePad) ||
    Boolean(rawSmc.bearishFvg && candleHigh >= rawSmc.bearishFvg.low - zonePad && lastPrice <= rawSmc.bearishFvg.high + zonePad) ||
    rawSmc.bslSwept;

  const bearInPerfectZone =
    tappedBearZone &&
    bearNotChasing &&
    (hasBearSmcCatalyst || (rawSmc.bearRejection && rawSmc.bosDirection === 'BEARISH_BOS'));

  // Smart Money Pillar Scoring (up to 32 pts)
  let smcBullPoints = 0;
  if (rawSmc.bullishOb) {
    smcBullPoints += 8;
    bullReasons.push(`Bullish Order Block ($${formatPrice(rawSmc.bullishOb.low)}–$${formatPrice(rawSmc.bullishOb.high)})`);
  }
  if (rawSmc.sslSwept) {
    smcBullPoints += 10;
    bullReasons.push(`Sell-Side Liquidity (SSL) sweep & reclaim confirmed`);
  }
  if (rawSmc.bullishFvg) {
    smcBullPoints += 5;
  }
  if (rawSmc.bosDirection === 'BULLISH_BOS') {
    smcBullPoints += 5;
  }
  if (rawSmc.bullRejection) {
    smcBullPoints += 4;
  }
  if (bullInPerfectZone) {
    smcBullPoints += 8;
  }

  let smcBearPoints = 0;
  if (rawSmc.bearishOb) {
    smcBearPoints += 8;
    bearReasons.push(`Bearish Order Block ($${formatPrice(rawSmc.bearishOb.low)}–$${formatPrice(rawSmc.bearishOb.high)})`);
  }
  if (rawSmc.bslSwept) {
    smcBearPoints += 10;
    bearReasons.push(`Buy-Side Liquidity (BSL) sweep & rejection confirmed`);
  }
  if (rawSmc.bearishFvg) {
    smcBearPoints += 5;
  }
  if (rawSmc.bosDirection === 'BEARISH_BOS') {
    smcBearPoints += 5;
  }
  if (rawSmc.bearRejection) {
    smcBearPoints += 4;
  }
  if (bearInPerfectZone) {
    smcBearPoints += 8;
  }

  bullScore += smcBullPoints;
  bearScore += smcBearPoints;

  // Funding Crowding Safety Guard
  if (fundingRatePct !== null) {
    if (fundingRatePct <= -0.015) bullScore += 3;
    else if (fundingRatePct >= 0.04) bullScore = Math.max(0, bullScore - 7);
    if (fundingRatePct >= 0.025) bearScore += 3;
    else if (fundingRatePct <= -0.04) bearScore = Math.max(0, bearScore - 7);
  }

  const spread = Math.abs(bullScore - bearScore);

  const isStrongLong =
    bullInPerfectZone &&
    bullEmaAligned &&
    bullMacroAligned &&
    bullRsiStrong &&
    bullMacdStrong &&
    volOk &&
    candleBullOk &&
    bullScore >= 80 &&
    spread >= 28;

  const isStrongShort =
    bearInPerfectZone &&
    bearEmaAligned &&
    bearMacroAligned &&
    bearRsiStrong &&
    bearMacdStrong &&
    volOk &&
    candleBearOk &&
    bearScore >= 80 &&
    spread >= 28;

  const allowStandardLong =
    !strongEntryOnly && bullInPerfectZone && bullScore > bearScore && bullScore >= 64 && spread >= 18;
  const allowStandardShort =
    !strongEntryOnly && bearInPerfectZone && bearScore > bullScore && bearScore >= 64 && spread >= 18;

  let direction: SignalDirection = 'NEUTRAL';
  let confidence = 50;
  let reasons: string[] = [];

  // Select dominant structural side for Entry Zone + SL/TP preview
  const dominantSide: 'LONG' | 'SHORT' =
    isStrongLong || allowStandardLong
      ? 'LONG'
      : isStrongShort || allowStandardShort
        ? 'SHORT'
        : bearScore > bullScore
          ? 'SHORT'
          : 'LONG';

  const activeZoneLow = dominantSide === 'LONG' ? bullZoneLow : bearZoneLow;
  const activeZoneHigh = dominantSide === 'LONG' ? bullZoneHigh : bearZoneHigh;
  const activeZoneLabel = dominantSide === 'LONG' ? bullZoneLabel : bearZoneLabel;
  const activeInZone = dominantSide === 'LONG' ? bullInPerfectZone : bearInPerfectZone;
  const activeRejection = dominantSide === 'LONG' ? rawSmc.bullRejection : rawSmc.bearRejection;
  const activeSmcScore = Math.min(
    100,
    Math.round(((dominantSide === 'LONG' ? smcBullPoints : smcBearPoints) / 36) * 100),
  );

  let zoneDistancePct = 0;
  if (!activeInZone && lastPrice > 0) {
    if (lastPrice > activeZoneHigh) {
      zoneDistancePct = Number((((lastPrice - activeZoneHigh) / lastPrice) * 100).toFixed(2));
    } else if (lastPrice < activeZoneLow) {
      zoneDistancePct = Number((((activeZoneLow - lastPrice) / lastPrice) * 100).toFixed(2));
    }
  }

  const entryZoneStatus: SmcAnalysis['entryZoneStatus'] = activeInZone
    ? 'PERFECT_ZONE'
    : zoneDistancePct <= 1.25
      ? 'APPROACHING_ZONE'
      : 'EXTENDED_WAIT';

  if (isStrongLong || allowStandardLong) {
    direction = 'LONG';
    confidence = Math.min(98, Math.max(strongEntryOnly ? 80 : 64, Math.round(bullScore)));
    reasons = [
      `PERFECT ZONE HIT: ${bullZoneLabel} ($${formatPrice(bullZoneLow)}–$${formatPrice(bullZoneHigh)})`,
      ...bullReasons.slice(0, 4),
    ];
  } else if (isStrongShort || allowStandardShort) {
    direction = 'SHORT';
    confidence = Math.min(98, Math.max(strongEntryOnly ? 80 : 64, Math.round(bearScore)));
    reasons = [
      `PERFECT ZONE HIT: ${bearZoneLabel} ($${formatPrice(bearZoneLow)}–$${formatPrice(bearZoneHigh)})`,
      ...bearReasons.slice(0, 4),
    ];
  } else {
    direction = 'NEUTRAL';
    const rawBest = Math.round(Math.max(bullScore, bearScore));
    confidence = strongEntryOnly
      ? Math.min(78, Math.max(25, rawBest))
      : Math.min(63, Math.max(25, rawBest));

    const missing: string[] = [];
    if (!activeInZone) {
      missing.push(
        zoneDistancePct > 0
          ? `Price in ${activeZoneLabel} (${zoneDistancePct.toFixed(2)}% away)`
          : `Tap of ${activeZoneLabel}`,
      );
    }
    if (dominantSide === 'LONG') {
      if (!hasBullSmcCatalyst) missing.push('Bullish OB / SSL Sweep / FVG');
      if (!bullEmaAligned) missing.push('EMA Ribbon');
      if (!bullMacroAligned) missing.push('Macro Trend');
      if (!bullRsiStrong) missing.push('RSI Zone');
      if (!bullMacdStrong) missing.push('MACD');
      if (!volOk) missing.push('Volume');
    } else {
      if (!hasBearSmcCatalyst) missing.push('Bearish OB / BSL Sweep / FVG');
      if (!bearEmaAligned) missing.push('EMA Ribbon');
      if (!bearMacroAligned) missing.push('Macro Trend');
      if (!bearRsiStrong) missing.push('RSI Zone');
      if (!bearMacdStrong) missing.push('MACD');
      if (!volOk) missing.push('Volume');
    }

    reasons = [
      `WAIT — Awaiting ${missing.slice(0, 2).join(' + ') || 'Perfect Entry Zone'}`,
      `${activeZoneLabel}: $${formatPrice(activeZoneLow)}–$${formatPrice(activeZoneHigh)} · Liq Pools BSL $${rawSmc.nearestBslPool ? formatPrice(rawSmc.nearestBslPool) : formatPrice(swingHigh)} / SSL $${rawSmc.nearestSslPool ? formatPrice(rawSmc.nearestSslPool) : formatPrice(swingLow)}`,
    ];
  }

  // Anchor Entry Zone to the true Institutional OB / FVG / Pullback Zone
  const entryMin = roundToPrecision(Math.min(activeZoneLow, activeZoneHigh), lastPrice);
  const entryMax = roundToPrecision(Math.max(activeZoneLow, activeZoneHigh), lastPrice);
  const entryMid = (entryMin + entryMax) / 2;

  // Trade Style Calibrated SL (tucked behind Order Block / Liquidity Wick) & R:R TP Geometry
  const atrStopMult = isSwing ? 1.8 : isScalp ? 1.3 : 1.55;
  const minStopPct = isSwing ? 0.009 : isScalp ? 0.0035 : 0.0055;
  const maxStopPct = isSwing ? 0.065 : isScalp ? 0.022 : 0.038;
  const [tp1Mult, tp2Mult, tp3Mult] = isSwing
    ? [1.2, 2.2, 3.6]
    : isScalp
      ? [1.0, 1.8, 2.8]
      : [1.1, 2.0, 3.2];

  const refPrice = direction !== 'NEUTRAL' ? lastPrice : entryMid;
  const minRiskDist = refPrice * minStopPct;
  const maxRiskDist = refPrice * maxStopPct;

  let stopLoss: number;
  let tp1: number;
  let tp2: number;
  let tp3: number;

  if (dominantSide === 'SHORT') {
    const atrStopDist = Math.min(maxRiskDist, Math.max(minRiskDist, effectiveAtr * atrStopMult));
    const obHighAnchor = rawSmc.bearishOb?.high ?? rawSmc.sweptBslLevel ?? entryMax;
    const structureStop = Math.max(obHighAnchor, entryMax) + effectiveAtr * 0.28;
    const boundedStop = Math.min(
      refPrice + maxRiskDist,
      Math.max(refPrice + atrStopDist * 0.85, structureStop),
    );
    const safeStop = Math.max(boundedStop, entryMax + minRiskDist * 0.25);
    stopLoss = roundToPrecision(safeStop, refPrice);

    const risk = Math.min(maxRiskDist, Math.max(stopLoss - refPrice, minRiskDist));
    tp1 = roundToPrecision(Math.max(refPrice * 0.5, refPrice - risk * tp1Mult), refPrice);
    tp2 = roundToPrecision(Math.max(refPrice * 0.4, refPrice - risk * tp2Mult), refPrice);
    tp3 = roundToPrecision(Math.max(refPrice * 0.25, refPrice - risk * tp3Mult), refPrice);
  } else {
    const atrStopDist = Math.min(maxRiskDist, Math.max(minRiskDist, effectiveAtr * atrStopMult));
    const obLowAnchor = rawSmc.bullishOb?.low ?? rawSmc.sweptSslLevel ?? entryMin;
    const structureStop = Math.min(obLowAnchor, entryMin) - effectiveAtr * 0.28;
    const boundedStop = Math.max(
      refPrice - maxRiskDist,
      Math.min(refPrice - atrStopDist * 0.85, structureStop),
    );
    const safeStop = Math.min(boundedStop, entryMin - minRiskDist * 0.25);
    stopLoss = roundToPrecision(Math.max(refPrice * 0.5, safeStop), refPrice);

    const risk = Math.min(maxRiskDist, Math.max(refPrice - stopLoss, minRiskDist));
    tp1 = roundToPrecision(refPrice + risk * tp1Mult, refPrice);
    tp2 = roundToPrecision(refPrice + risk * tp2Mult, refPrice);
    tp3 = roundToPrecision(refPrice + risk * tp3Mult, refPrice);
  }

  const stopLossPct = refPrice > 0 ? Math.abs(((stopLoss - refPrice) / refPrice) * 100) : 2;
  const tp1Pct = refPrice > 0 ? Math.abs(((tp1 - refPrice) / refPrice) * 100) : 2;
  const tp2Pct = refPrice > 0 ? Math.abs(((tp2 - refPrice) / refPrice) * 100) : 4;
  const tp3Pct = refPrice > 0 ? Math.abs(((tp3 - refPrice) / refPrice) * 100) : 6;
  const riskRewardRatio = stopLossPct > 0 ? Number((tp2Pct / stopLossPct).toFixed(2)) : tp2Mult;

  let suggestedLeverage = 3;
  if (isSwing) {
    if (stopLossPct <= 2.5) suggestedLeverage = 5;
    else if (stopLossPct <= 4.5) suggestedLeverage = 4;
    else if (stopLossPct <= 7.0) suggestedLeverage = 3;
    else suggestedLeverage = 2;
  } else if (isScalp) {
    if (stopLossPct <= 1.0) suggestedLeverage = 15;
    else if (stopLossPct <= 1.8) suggestedLeverage = 10;
    else if (stopLossPct <= 2.8) suggestedLeverage = 7;
    else suggestedLeverage = 5;
  } else {
    if (stopLossPct <= 1.5) suggestedLeverage = 10;
    else if (stopLossPct <= 2.5) suggestedLeverage = 7;
    else if (stopLossPct <= 4.0) suggestedLeverage = 5;
    else suggestedLeverage = 3;
  }

  const activeFvg =
    dominantSide === 'LONG' && rawSmc.bullishFvg
      ? {
          type: 'BULLISH' as const,
          low: roundToPrecision(rawSmc.bullishFvg.low, lastPrice),
          high: roundToPrecision(rawSmc.bullishFvg.high, lastPrice),
        }
      : dominantSide === 'SHORT' && rawSmc.bearishFvg
        ? {
            type: 'BEARISH' as const,
            low: roundToPrecision(rawSmc.bearishFvg.low, lastPrice),
            high: roundToPrecision(rawSmc.bearishFvg.high, lastPrice),
          }
        : rawSmc.bullishFvg
          ? {
              type: 'BULLISH' as const,
              low: roundToPrecision(rawSmc.bullishFvg.low, lastPrice),
              high: roundToPrecision(rawSmc.bullishFvg.high, lastPrice),
            }
          : rawSmc.bearishFvg
            ? {
                type: 'BEARISH' as const,
                low: roundToPrecision(rawSmc.bearishFvg.low, lastPrice),
                high: roundToPrecision(rawSmc.bearishFvg.high, lastPrice),
              }
            : null;

  const smc: SmcAnalysis = {
    entryZoneStatus,
    inEntryZone: activeInZone,
    zoneLabel: activeZoneLabel,
    zoneDistancePct,
    bullishOb: rawSmc.bullishOb
      ? {
          low: roundToPrecision(rawSmc.bullishOb.low, lastPrice),
          high: roundToPrecision(rawSmc.bullishOb.high, lastPrice),
        }
      : null,
    bearishOb: rawSmc.bearishOb
      ? {
          low: roundToPrecision(rawSmc.bearishOb.low, lastPrice),
          high: roundToPrecision(rawSmc.bearishOb.high, lastPrice),
        }
      : null,
    fvgZone: activeFvg,
    liquiditySweep: rawSmc.sslSwept ? 'SSL_SWEEP' : rawSmc.bslSwept ? 'BSL_SWEEP' : 'NONE',
    nearestBslPool: rawSmc.nearestBslPool ? roundToPrecision(rawSmc.nearestBslPool, lastPrice) : null,
    nearestSslPool: rawSmc.nearestSslPool ? roundToPrecision(rawSmc.nearestSslPool, lastPrice) : null,
    bosDirection: rawSmc.bosDirection,
    rejectionConfirmed: activeRejection,
    smcConfluenceScore: activeSmcScore,
  };

  const chartStart = Math.max(0, candles.length - 64);
  const chartCandles: ChartCandle[] = candles.slice(chartStart).map((c, offset) => {
    const i = chartStart + offset;
    return {
      ...c,
      ema9: ema9Series[i],
      ema21: ema21Series[i],
      ema50: ema50Series[i],
    };
  });

  const baseAsset = symbol.replace(/(USDC|USDT)$/, '');

  return {
    symbol,
    baseAsset,
    exchangeUsed,
    timeframe,
    tradeStyle,
    direction,
    confidence,
    lastPrice: roundToPrecision(lastPrice, lastPrice),
    priceChange24hPct: Number(priceChange24hPct.toFixed(2)),
    quoteVolume24h,
    fundingRatePct: fundingRatePct !== null ? Number(fundingRatePct.toFixed(4)) : null,
    openInterestUsd: openInterestUsd ?? null,
    bestBid: bestBid ?? null,
    bestAsk: bestAsk ?? null,
    entryMin,
    entryMax,
    stopLoss,
    stopLossPct: Number(stopLossPct.toFixed(2)),
    tp1,
    tp1Pct: Number(tp1Pct.toFixed(2)),
    tp2,
    tp2Pct: Number(tp2Pct.toFixed(2)),
    tp3,
    tp3Pct: Number(tp3Pct.toFixed(2)),
    riskRewardRatio,
    suggestedLeverage,
    indicators: {
      ema9: roundToPrecision(ema9, lastPrice),
      ema21: roundToPrecision(ema21, lastPrice),
      ema50: roundToPrecision(ema50, lastPrice),
      ema200: ema200 !== null ? roundToPrecision(ema200, lastPrice) : null,
      rsi14: Number(rsi14.toFixed(2)),
      macdLine: Number(macd.macdLine.toFixed(6)),
      macdSignal: Number(macd.signalLine.toFixed(6)),
      macdHistogram: Number(macd.histogram.toFixed(6)),
      prevMacdHistogram: Number(macd.prevHistogram.toFixed(6)),
      bbUpper: roundToPrecision(bb.upper, lastPrice),
      bbMiddle: roundToPrecision(bb.middle, lastPrice),
      bbLower: roundToPrecision(bb.lower, lastPrice),
      bbPercentB: Number(bb.percentB.toFixed(3)),
      atr14: roundToPrecision(atr14, lastPrice),
      atrPct: Number(atrPct.toFixed(2)),
      volumeRatio: Number(volumeRatio.toFixed(2)),
      swingHigh: roundToPrecision(swingHigh, lastPrice),
      swingLow: roundToPrecision(swingLow, lastPrice),
    },
    smc,
    rawDirection: direction,
    rawConfidence: confidence,
    baseReasons: reasons,
    reasons,
    chartCandles,
    generatedAt: new Date().toISOString(),
  };
}
