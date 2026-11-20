import type { Candle, ExchangeFeed, MarketSnapshot, Timeframe } from './types.ts';

const REQUEST_TIMEOUT_MS = 6500;

async function fetchJsonWithTimeout<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AltPulse-Futures-Scanner/1.0',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeSymbol(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.endsWith('USDC')) return cleaned;
  if (cleaned.endsWith('USDT')) return `${cleaned.slice(0, -4)}USDC`;
  return `${cleaned}USDC`;
}

export function toBaseAsset(symbol: string): string {
  const norm = normalizeSymbol(symbol);
  return norm.replace(/(USDC|USDT)$/, '');
}

// --- Lighter DEX (lighter.xyz / mainnet.zklighter.elliot.ai) Market Cache ---
interface LighterMarketMeta {
  marketId: number;
  symbol: string;
}

interface LighterStatEntry {
  symbol: string;
  last_trade_price: number;
  daily_quote_token_volume: number;
  daily_price_change: number;
  daily_price_high?: number;
  daily_price_low?: number;
}

let lighterMarketsCache: { fetchedAt: number; byBase: Map<string, LighterMarketMeta> } | null = null;
let lighterStatsCache: { fetchedAt: number; byBase: Map<string, LighterStatEntry> } | null = null;
let lighterFundingCache: { fetchedAt: number; byBase: Map<string, number> } | null = null;

async function getLighterMarkets(): Promise<Map<string, LighterMarketMeta>> {
  if (lighterMarketsCache && Date.now() - lighterMarketsCache.fetchedAt < 5 * 60_000) {
    return lighterMarketsCache.byBase;
  }
  const data = await fetchJsonWithTimeout<{
    code: number;
    order_books?: Array<{ symbol: string; market_id: number; status: string; market_type: string }>;
  }>('https://mainnet.zklighter.elliot.ai/api/v1/orderBooks?filter=perp');

  const map = new Map<string, LighterMarketMeta>();
  for (const ob of data.order_books ?? []) {
    if (ob.status === 'active') {
      map.set(ob.symbol.toUpperCase(), { marketId: ob.market_id, symbol: ob.symbol.toUpperCase() });
    }
  }
  lighterMarketsCache = { fetchedAt: Date.now(), byBase: map };
  return map;
}

async function getLighterStats(): Promise<Map<string, LighterStatEntry>> {
  if (lighterStatsCache && Date.now() - lighterStatsCache.fetchedAt < 10_000) {
    return lighterStatsCache.byBase;
  }
  const data = await fetchJsonWithTimeout<{
    code: number;
    order_book_stats?: LighterStatEntry[];
  }>('https://mainnet.zklighter.elliot.ai/api/v1/exchangeStats');

  const map = new Map<string, LighterStatEntry>();
  for (const st of data.order_book_stats ?? []) {
    map.set(st.symbol.toUpperCase(), st);
  }
  lighterStatsCache = { fetchedAt: Date.now(), byBase: map };
  return map;
}

async function getLighterFundingRates(): Promise<Map<string, number>> {
  if (lighterFundingCache && Date.now() - lighterFundingCache.fetchedAt < 30_000) {
    return lighterFundingCache.byBase;
  }
  const data = await fetchJsonWithTimeout<{
    code: number;
    funding_rates?: Array<{ exchange: string; symbol: string; rate: number }>;
  }>('https://mainnet.zklighter.elliot.ai/api/v1/funding-rates');

  const map = new Map<string, number>();
  for (const fr of data.funding_rates ?? []) {
    const key = fr.symbol.toUpperCase();
    // Prefer lighter's own funding rate if present, otherwise keep first available
    if (fr.exchange === 'lighter' || !map.has(key)) {
      map.set(key, Number(fr.rate) * 100);
    }
  }
  lighterFundingCache = { fetchedAt: Date.now(), byBase: map };
  return map;
}

function getTimeframeSeconds(tf: Timeframe): number {
  switch (tf) {
    case '5m':
      return 5 * 60;
    case '15m':
      return 15 * 60;
    case '30m':
      return 30 * 60;
    case '1h':
      return 60 * 60;
    case '4h':
      return 4 * 60 * 60;
    case '1d':
      return 24 * 60 * 60;
  }
}

async function fetchFromLighter(symbol: string, timeframe: Timeframe, limit: number): Promise<MarketSnapshot> {
  const norm = normalizeSymbol(symbol);
  const base = toBaseAsset(norm);
  // Lighter uses e.g. 1000PEPE or PEPE; check direct base first, then 1000-prefixed
  const markets = await getLighterMarkets();
  const marketMeta = markets.get(base) ?? markets.get(`1000${base}`);
  if (!marketMeta) {
    throw new Error(`${base} is not listed on Lighter perp markets`);
  }

  const endSec = Math.floor(Date.now() / 1000);
  const startSec = endSec - getTimeframeSeconds(timeframe) * (limit + 10);

  const [candleRes, statsMap, fundingMap] = await Promise.all([
    fetchJsonWithTimeout<{
      code: number;
      c?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number; V?: number }>;
    }>(
      `https://mainnet.zklighter.elliot.ai/api/v1/candles?market_id=${marketMeta.marketId}&resolution=${timeframe}&start_timestamp=${startSec}&end_timestamp=${endSec}&count_back=${limit}`,
    ),
    getLighterStats().catch(() => new Map<string, LighterStatEntry>()),
    getLighterFundingRates().catch(() => new Map<string, number>()),
  ]);

  const rawCandles = candleRes.c ?? [];
  const minRequired = timeframe === '1d' ? 20 : 30;
  if (rawCandles.length < minRequired) {
    throw new Error(`Insufficient Lighter candles for ${marketMeta.symbol}`);
  }

  const scaleFactor = marketMeta.symbol.startsWith('1000') && !base.startsWith('1000') ? 0.001 : 1;

  const candles: Candle[] = rawCandles
    .map((k) => {
      const rawT = Number(k.t);
      return {
        timestamp: rawT < 1e12 ? rawT * 1000 : rawT,
        open: Number(k.o) * scaleFactor,
        high: Number(k.h) * scaleFactor,
        low: Number(k.l) * scaleFactor,
        close: Number(k.c) * scaleFactor,
        volume: Number(k.v),
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  const stat = statsMap.get(marketMeta.symbol);
  const fundingRatePct = fundingMap.get(marketMeta.symbol) ?? null;
  const lastPrice = stat?.last_trade_price
    ? Number(stat.last_trade_price) * scaleFactor
    : candles[candles.length - 1].close;

  return {
    symbol: norm,
    exchangeUsed: 'lighter',
    lastPrice,
    priceChange24hPct: stat ? Number(stat.daily_price_change) : 0,
    quoteVolume24h: stat ? Number(stat.daily_quote_token_volume) : 0,
    high24h: stat?.daily_price_high ? Number(stat.daily_price_high) * scaleFactor : 0,
    low24h: stat?.daily_price_low ? Number(stat.daily_price_low) * scaleFactor : 0,
    fundingRatePct: fundingRatePct !== null && Number.isFinite(fundingRatePct) ? fundingRatePct : null,
    openInterestUsd: null,
    bestBid: null,
    bestAsk: null,
    candles,
  };
}

function toOkxInstId(symbol: string, quote: 'USDC' | 'USDT' = 'USDC'): string {
  const base = toBaseAsset(symbol);
  return `${base}-${quote}-SWAP`;
}

function mapBybitInterval(tf: Timeframe): string {
  switch (tf) {
    case '5m':
      return '5';
    case '15m':
      return '15';
    case '30m':
      return '30';
    case '1h':
      return '60';
    case '4h':
      return '240';
    case '1d':
      return 'D';
  }
}

function mapOkxBar(tf: Timeframe): string {
  switch (tf) {
    case '5m':
      return '5m';
    case '15m':
      return '15m';
    case '30m':
      return '30m';
    case '1h':
      return '1H';
    case '4h':
      return '4H';
    case '1d':
      return '1D';
  }
}

async function fetchFromBinanceWithSymbol(
  norm: string,
  exchangeSymbol: string,
  timeframe: Timeframe,
  limit: number,
): Promise<MarketSnapshot> {
  const [klines, ticker, premium] = await Promise.all([
    fetchJsonWithTimeout<Array<[number, string, string, string, string, string]>>(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${exchangeSymbol}&interval=${timeframe}&limit=${limit}`,
    ),
    fetchJsonWithTimeout<{
      lastPrice: string;
      priceChangePercent: string;
      quoteVolume: string;
      highPrice: string;
      lowPrice: string;
    }>(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${exchangeSymbol}`),
    fetchJsonWithTimeout<{ lastFundingRate?: string }>(
      `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${exchangeSymbol}`,
    ).catch(() => ({ lastFundingRate: undefined })),
  ]);

  const minRequired = timeframe === '1d' ? 20 : 30;
  if (!Array.isArray(klines) || klines.length < minRequired) {
    throw new Error(`Insufficient Binance klines for ${exchangeSymbol}`);
  }

  const candles: Candle[] = klines.map((k) => ({
    timestamp: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));

  const fundingRatePct =
    premium.lastFundingRate !== undefined ? Number(premium.lastFundingRate) * 100 : null;

  return {
    symbol: norm,
    exchangeUsed: 'binance',
    lastPrice: Number(ticker.lastPrice) || candles[candles.length - 1].close,
    priceChange24hPct: Number(ticker.priceChangePercent) || 0,
    quoteVolume24h: Number(ticker.quoteVolume) || 0,
    high24h: Number(ticker.highPrice) || 0,
    low24h: Number(ticker.lowPrice) || 0,
    fundingRatePct: fundingRatePct !== null && Number.isFinite(fundingRatePct) ? fundingRatePct : null,
    openInterestUsd: null,
    bestBid: null,
    bestAsk: null,
    candles,
  };
}

async function fetchFromBinance(symbol: string, timeframe: Timeframe, limit: number): Promise<MarketSnapshot> {
  const norm = normalizeSymbol(symbol);
  const base = toBaseAsset(norm);
  try {
    return await fetchFromBinanceWithSymbol(norm, `${base}USDC`, timeframe, limit);
  } catch {
    return await fetchFromBinanceWithSymbol(norm, `${base}USDT`, timeframe, limit);
  }
}

async function fetchFromBybit(symbol: string, timeframe: Timeframe, limit: number): Promise<MarketSnapshot> {
  const norm = normalizeSymbol(symbol);
  const base = toBaseAsset(norm);
  const bybitSymbol = `${base}USDT`;
  const interval = mapBybitInterval(timeframe);
  const [klineRes, tickerRes] = await Promise.all([
    fetchJsonWithTimeout<{
      retCode: number;
      retMsg: string;
      result?: { list?: Array<[string, string, string, string, string, string, string]> };
    }>(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${bybitSymbol}&interval=${interval}&limit=${limit}`),
    fetchJsonWithTimeout<{
      retCode: number;
      result?: {
        list?: Array<{
          lastPrice: string;
          price24hPcnt: string;
          turnover24h: string;
          highPrice24h: string;
          lowPrice24h: string;
          fundingRate?: string;
        }>;
      };
    }>(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${bybitSymbol}`),
  ]);

  const rawList = klineRes.result?.list;
  const minRequired = timeframe === '1d' ? 20 : 30;
  if (klineRes.retCode !== 0 || !Array.isArray(rawList) || rawList.length < minRequired) {
    throw new Error(`Bybit error for ${norm}: ${klineRes.retMsg || 'no data'}`);
  }

  const candles: Candle[] = [...rawList].reverse().map((k) => ({
    timestamp: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));

  const t = tickerRes.result?.list?.[0];
  const fundingRatePct = t?.fundingRate !== undefined ? Number(t.fundingRate) * 100 : null;

  return {
    symbol: norm,
    exchangeUsed: 'bybit',
    lastPrice: t ? Number(t.lastPrice) : candles[candles.length - 1].close,
    priceChange24hPct: t ? Number(t.price24hPcnt) * 100 : 0,
    quoteVolume24h: t ? Number(t.turnover24h) : 0,
    high24h: t ? Number(t.highPrice24h) : 0,
    low24h: t ? Number(t.lowPrice24h) : 0,
    fundingRatePct: fundingRatePct !== null && Number.isFinite(fundingRatePct) ? fundingRatePct : null,
    openInterestUsd: null,
    bestBid: null,
    bestAsk: null,
    candles,
  };
}

async function fetchFromOkxWithInst(
  norm: string,
  instId: string,
  timeframe: Timeframe,
  limit: number,
): Promise<MarketSnapshot> {
  const bar = mapOkxBar(timeframe);

  const [candleRes, tickerRes, fundingRes] = await Promise.all([
    fetchJsonWithTimeout<{
      code: string;
      msg?: string;
      data?: Array<[string, string, string, string, string, string, string, string, string]>;
    }>(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${Math.min(limit, 300)}`),
    fetchJsonWithTimeout<{
      code: string;
      data?: Array<{
        last: string;
        open24h: string;
        high24h: string;
        low24h: string;
        volCcy24h: string;
      }>;
    }>(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`),
    fetchJsonWithTimeout<{
      code: string;
      data?: Array<{ fundingRate?: string }>;
    }>(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`).catch(() => ({
      code: '1',
      data: [],
    })),
  ]);

  const minRequired = timeframe === '1d' ? 20 : 30;
  if (candleRes.code !== '0' || !Array.isArray(candleRes.data) || candleRes.data.length < minRequired) {
    throw new Error(`OKX error for ${instId}: ${candleRes.msg || 'no data'}`);
  }

  const candles: Candle[] = [...candleRes.data].reverse().map((k) => ({
    timestamp: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));

  const t = tickerRes.data?.[0];
  const lastPrice = t ? Number(t.last) : candles[candles.length - 1].close;
  const open24h = t ? Number(t.open24h) : lastPrice;
  const priceChange24hPct = open24h > 0 ? ((lastPrice - open24h) / open24h) * 100 : 0;
  const quoteVolume24h = t ? Number(t.volCcy24h) * lastPrice : 0;
  const rawFunding = fundingRes.data?.[0]?.fundingRate;
  const fundingRatePct = rawFunding !== undefined ? Number(rawFunding) * 100 : null;

  return {
    symbol: norm,
    exchangeUsed: 'okx',
    lastPrice,
    priceChange24hPct,
    quoteVolume24h,
    high24h: t ? Number(t.high24h) : 0,
    low24h: t ? Number(t.low24h) : 0,
    fundingRatePct: fundingRatePct !== null && Number.isFinite(fundingRatePct) ? fundingRatePct : null,
    openInterestUsd: null,
    bestBid: null,
    bestAsk: null,
    candles,
  };
}

async function fetchFromOkx(symbol: string, timeframe: Timeframe, limit: number): Promise<MarketSnapshot> {
  const norm = normalizeSymbol(symbol);
  try {
    return await fetchFromOkxWithInst(norm, toOkxInstId(norm, 'USDC'), timeframe, limit);
  } catch {
    return await fetchFromOkxWithInst(norm, toOkxInstId(norm, 'USDT'), timeframe, limit);
  }
}

export async function fetchMarketSnapshot(
  symbol: string,
  timeframe: Timeframe,
  preferredExchange: ExchangeFeed = 'lighter',
  limit = 220,
): Promise<MarketSnapshot> {
  const allFeeds = ['lighter', 'binance', 'bybit', 'okx'] as const;
  const order: Array<'lighter' | 'binance' | 'bybit' | 'okx'> =
    preferredExchange === 'auto'
      ? ['lighter', 'binance', 'bybit', 'okx']
      : [preferredExchange, ...allFeeds.filter((e) => e !== preferredExchange)];

  let lastError: Error | null = null;
  for (const exchange of order) {
    try {
      if (exchange === 'lighter') {
        return await fetchFromLighter(symbol, timeframe, limit);
      }
      if (exchange === 'binance') {
        return await fetchFromBinance(symbol, timeframe, limit);
      }
      if (exchange === 'bybit') {
        return await fetchFromBybit(symbol, timeframe, limit);
      }
      return await fetchFromOkx(symbol, timeframe, limit);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error(`Failed to fetch market data for ${symbol}`);
}
