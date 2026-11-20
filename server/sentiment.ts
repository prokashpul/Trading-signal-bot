import type { FuturesSignal, GlobalSentiment, SentimentHistoryPoint } from './types.ts';

let cachedFng: {
  fetchedAt: number;
  value: number | null;
  classification: string | null;
  history: SentimentHistoryPoint[];
} | null = null;

const bullBearHistory: Array<{ timestamp: number; value: number }> = [];

export async function fetchFearAndGreedIndex(): Promise<{
  value: number | null;
  classification: string | null;
  history: SentimentHistoryPoint[];
}> {
  if (cachedFng && Date.now() - cachedFng.fetchedAt < 15 * 60_000) {
    return {
      value: cachedFng.value,
      classification: cachedFng.classification,
      history: cachedFng.history,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=14', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`FNG HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      data?: Array<{
        value: string;
        value_classification: string;
        timestamp: string;
      }>;
    };

    const raw = Array.isArray(json.data) ? json.data : [];
    const history: SentimentHistoryPoint[] = [...raw]
      .reverse()
      .map((item) => ({
        value: Number(item.value),
        classification: item.value_classification,
        timestamp: Number(item.timestamp) * 1000,
      }))
      .filter((p) => Number.isFinite(p.value));

    const latest = history[history.length - 1];
    cachedFng = {
      fetchedAt: Date.now(),
      value: latest ? latest.value : null,
      classification: latest ? latest.classification : null,
      history,
    };

    return {
      value: cachedFng.value,
      classification: cachedFng.classification,
      history: cachedFng.history,
    };
  } catch {
    return {
      value: cachedFng?.value ?? null,
      classification: cachedFng?.classification ?? null,
      history: cachedFng?.history ?? [],
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function buildGlobalSentiment(
  signals: FuturesSignal[],
  recordSnapshot = false,
): Promise<GlobalSentiment> {
  const fng = await fetchFearAndGreedIndex();

  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  let rsiSum = 0;

  for (const s of signals) {
    if (s.direction === 'LONG') bullishCount++;
    else if (s.direction === 'SHORT') bearishCount++;
    else neutralCount++;
    rsiSum += s.indicators.rsi14;
  }

  const directionalTotal = bullishCount + bearishCount;
  const marketAvgRsi = signals.length > 0 ? Number((rsiSum / signals.length).toFixed(1)) : 50;

  // Bullish ratio across directional setups (falls back to RSI-centered sentiment if all neutral)
  const bullishRatioPct =
    directionalTotal > 0
      ? Math.round((bullishCount / directionalTotal) * 100)
      : Math.round(Math.min(100, Math.max(0, marketAvgRsi)));

  if (recordSnapshot && signals.length > 0) {
    const now = Date.now();
    const last = bullBearHistory[bullBearHistory.length - 1];
    if (!last || now - last.timestamp >= 20_000) {
      bullBearHistory.push({ timestamp: now, value: bullishRatioPct });
      if (bullBearHistory.length > 24) {
        bullBearHistory.shift();
      }
    }
  }

  return {
    fearGreedValue: fng.value,
    fearGreedClassification: fng.classification,
    fearGreedHistory: fng.history,
    bullishCount,
    bearishCount,
    neutralCount,
    bullishRatioPct,
    bullBearHistory: [...bullBearHistory],
    marketAvgRsi,
    updatedAt: new Date().toISOString(),
  };
}
