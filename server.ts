import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import WebSocket, { WebSocketServer } from 'ws';
import { analyzeMarketSnapshot } from './server/analyzer.ts';
import { fetchMarketSnapshot, normalizeSymbol, toBaseAsset } from './server/market.ts';
import { buildGlobalSentiment } from './server/sentiment.ts';
import { botStore } from './server/store.ts';
import {
  ALL_TIMEFRAMES,
  type AlertConditionType,
  type ExchangeFeed,
  type FuturesSignal,
  type LiveTickUpdate,
  type ScannerStatus,
  type Timeframe,
  type TradeMode,
} from './server/types.ts';

const PORT = Number(process.env.PORT) || 3000;

let isScanning = false;
let pendingScanRequested = false;
let scanGeneration = 0;
let mtfScanRunning = false;
let activeScanPromise: Promise<{
  signals: FuturesSignal[];
  failedSymbols: string[];
}> | null = null;
let nextScanAtMs: number | null = null;
const pendingTickMap = new Map<string, LiveTickUpdate>();
let wssClients: Set<WebSocket> = new Set();

function broadcastWs(event: Record<string, unknown>): void {
  if (wssClients.size === 0) return;
  const payload = JSON.stringify(event);
  for (const client of wssClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function getScannerStatus(): ScannerStatus {
  return {
    isScanning,
    lastScanAt: botStore.lastScanAt,
    nextScanAt: nextScanAtMs ? new Date(nextScanAtMs).toISOString() : null,
    lastError: botStore.lastError,
    scannedCount: botStore.signals.length,
    failedSymbols: botStore.failedSymbols,
    lighterStreamConnected: botStore.lighterStreamConnected,
    lastTickAt: botStore.lastTickAt,
    mtfTimeframesReady: botStore.getReadyTimeframes(),
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  async function next(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        const value = await worker(items[idx]);
        results[idx] = { status: 'fulfilled', value };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

function getMtfFreshnessMs(tf: Timeframe): number {
  switch (tf) {
    case '5m':
      return 35_000;
    case '15m':
      return 45_000;
    case '30m':
      return 60_000;
    case '1h':
      return 70_000;
    case '4h':
      return 110_000;
    case '1d':
      return 180_000;
  }
}

async function scanSingleTimeframe(
  watchlist: string[],
  timeframe: Timeframe,
  tradeMode: TradeMode,
  exchange: ExchangeFeed,
  strongEntryOnly: boolean,
  concurrency = 10,
): Promise<{ signals: FuturesSignal[]; failedSymbols: string[] }> {
  const settled = await runWithConcurrency(watchlist, concurrency, async (symbol) => {
    const snapshot = await fetchMarketSnapshot(symbol, timeframe, exchange, 220);
    return analyzeMarketSnapshot(snapshot, timeframe, tradeMode, strongEntryOnly);
  });

  const signals: FuturesSignal[] = [];
  const failedSymbols: string[] = [];

  settled.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      signals.push(res.value);
    } else {
      failedSymbols.push(watchlist[i]);
    }
  });

  signals.sort((a, b) => {
    const aActive = a.direction !== 'NEUTRAL' ? 1 : 0;
    const bActive = b.direction !== 'NEUTRAL' ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    if (a.riskRewardRatio !== b.riskRewardRatio) return b.riskRewardRatio - a.riskRewardRatio;
    if (a.quoteVolume24h !== b.quoteVolume24h) return b.quoteVolume24h - a.quoteVolume24h;
    if (a.symbol === 'BTCUSDC') return -1;
    if (b.symbol === 'BTCUSDC') return 1;
    return 0;
  });

  return { signals, failedSymbols };
}

async function runBackgroundMtfScan(
  generation: number,
  primaryTf: Timeframe,
  tradeMode: TradeMode,
  exchange: ExchangeFeed,
  strongEntryOnly: boolean,
  watchlist: string[],
): Promise<void> {
  if (mtfScanRunning) return;
  mtfScanRunning = true;

  try {
    // Prioritize intraday/scalp entry timeframes (5m, 15m, 1h, 4h, 30m, 1d) so perfect OB/liquidity setups fire promptly
    const priorityOrder: Timeframe[] = ['5m', '15m', '1h', '4h', '30m', '1d'];
    const otherTfs = priorityOrder.filter((tf) => tf !== primaryTf);

    for (const tf of otherTfs) {
      if (generation !== scanGeneration || pendingScanRequested || isScanning) break;

      const lastAt = botStore.lastTfScanAt.get(tf) ?? 0;
      const hasCached = (botStore.signalsByTimeframe.get(tf)?.length ?? 0) > 0;
      if (hasCached && Date.now() - lastAt < getMtfFreshnessMs(tf)) {
        continue;
      }

      const { signals } = await scanSingleTimeframe(
        watchlist,
        tf,
        tradeMode,
        exchange,
        strongEntryOnly,
        8,
      );
      if (generation !== scanGeneration || pendingScanRequested) break;
      if (signals.length === 0) continue;

      botStore.setTimeframeSignals(tf, signals);
      const addedFeed = botStore.recordActionableSignals(signals);
      const newTradeAlarms = botStore.evaluateTradeAlarmsOnScan(signals);

      broadcastWs({
        type: 'mtf:update',
        payload: {
          timeframe: tf,
          mtfSignals: botStore.getMtfSignalSummaries(),
          addedFeed,
          scanner: getScannerStatus(),
        },
      });

      if (newTradeAlarms.length > 0) {
        broadcastWs({
          type: 'tradeAlarms:triggered',
          payload: {
            events: newTradeAlarms,
            activeTrades: botStore.getActiveTrades(),
            tradeAlarms: botStore.getTradeAlarms(),
          },
        });
      }

      // Brief yield between timeframes to avoid bursting upstream APIs
      await new Promise((r) => setTimeout(r, 120));
    }
  } catch (err) {
    console.error('Background MTF scan warning:', err);
  } finally {
    mtfScanRunning = false;
  }
}

async function performMarketScan(opts?: {
  timeframe?: Timeframe;
  tradeMode?: TradeMode;
  exchange?: ExchangeFeed;
  forceQueue?: boolean;
}): Promise<{
  signals: FuturesSignal[];
  failedSymbols: string[];
}> {
  if (opts?.timeframe || opts?.tradeMode || opts?.exchange) {
    const prevConfig = botStore.getConfig();
    const updated = botStore.updateConfig({
      ...(opts.timeframe ? { timeframe: opts.timeframe } : {}),
      ...(opts.tradeMode ? { tradeMode: opts.tradeMode } : {}),
      ...(opts.exchange ? { exchange: opts.exchange } : {}),
    });
    if (
      (opts.tradeMode && opts.tradeMode !== prevConfig.tradeMode) ||
      (opts.exchange && opts.exchange !== prevConfig.exchange)
    ) {
      botStore.invalidateOtherTimeframes();
    }
    // If we already have cached MTF signals for the newly selected timeframe, promote them immediately
    if (opts.timeframe && updated.tradeMode === prevConfig.tradeMode && updated.exchange === prevConfig.exchange) {
      const cached = botStore.signalsByTimeframe.get(opts.timeframe);
      if (cached && cached.length > 0) {
        botStore.signals = cached;
      }
    }
    broadcastWs({ type: 'config:update', payload: updated });
  }

  scanGeneration++;

  if (activeScanPromise) {
    if (opts?.forceQueue || opts?.timeframe || opts?.tradeMode || opts?.exchange) {
      pendingScanRequested = true;
    }
    return activeScanPromise;
  }

  activeScanPromise = (async () => {
    let latestResult: { signals: FuturesSignal[]; failedSymbols: string[] } = {
      signals: botStore.signals,
      failedSymbols: botStore.failedSymbols,
    };

    isScanning = true;
    broadcastWs({ type: 'scanner:status', payload: getScannerStatus() });

    try {
      do {
        pendingScanRequested = false;
        const currentGen = scanGeneration;
        const config = botStore.getConfig();
        const timeframe = config.timeframe;
        const tradeMode = config.tradeMode;
        const exchange = config.exchange;
        const strongEntryOnly = config.strongEntryOnly;

        const { signals, failedSymbols } = await scanSingleTimeframe(
          config.watchlist,
          timeframe,
          tradeMode,
          exchange,
          strongEntryOnly,
          10,
        );

        botStore.setTimeframeSignals(timeframe, signals);
        botStore.failedSymbols = failedSymbols;
        botStore.lastScanAt = new Date().toISOString();
        botStore.lastError =
          signals.length === 0 && failedSymbols.length > 0
            ? 'Could not reach exchange market APIs for any watchlist symbol.'
            : null;

        const addedFeed = botStore.recordActionableSignals(signals);
        const sentiment = await buildGlobalSentiment(signals, true);
        const triggeredAlerts = botStore.evaluateScanAlerts(signals);
        const newTradeAlarms = botStore.evaluateTradeAlarmsOnScan(signals);

        if (config.autoScanEnabled) {
          nextScanAtMs = Date.now() + config.autoScanIntervalSeconds * 1000;
        } else {
          nextScanAtMs = null;
        }

        // Clear isScanning before broadcasting final update when no rescan is queued
        if (!pendingScanRequested) {
          isScanning = false;
        }

        broadcastWs({
          type: 'signals:update',
          payload: {
            signals,
            mtfSignals: botStore.getMtfSignalSummaries(),
            scanner: getScannerStatus(),
            addedFeed,
            sentiment,
            activeTrades: botStore.getActiveTrades(),
            tradeAlarms: botStore.getTradeAlarms(),
          },
        });

        if (triggeredAlerts.length > 0) {
          broadcastWs({
            type: 'alerts:triggered',
            payload: {
              events: triggeredAlerts,
              alertRules: botStore.getAlertRules(),
              triggeredAlerts: botStore.getTriggeredAlerts(),
            },
          });
        }

        if (newTradeAlarms.length > 0) {
          broadcastWs({
            type: 'tradeAlarms:triggered',
            payload: {
              events: newTradeAlarms,
              activeTrades: botStore.getActiveTrades(),
              tradeAlarms: botStore.getTradeAlarms(),
            },
          });
        }

        latestResult = { signals, failedSymbols };

        // Kick off multi-timeframe scan for all other timeframes in background
        if (!pendingScanRequested) {
          const cfg = botStore.getConfig();
          void runBackgroundMtfScan(
            currentGen,
            cfg.timeframe,
            cfg.tradeMode,
            cfg.exchange,
            cfg.strongEntryOnly,
            cfg.watchlist,
          );
        }
      } while (pendingScanRequested);

      return latestResult;
    } finally {
      isScanning = false;
      pendingScanRequested = false;
      activeScanPromise = null;
      broadcastWs({ type: 'scanner:status', payload: getScannerStatus() });
    }
  })();

  return activeScanPromise;
}

// --- Upstream Live WebSocket Stream from Lighter DEX (lighter.xyz) ---
function startLighterLiveStream(): void {
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    const upstream = new WebSocket('wss://mainnet.zklighter.elliot.ai/stream');

    upstream.on('open', () => {
      botStore.lighterStreamConnected = true;
      upstream.send(JSON.stringify({ type: 'subscribe', channel: 'market_stats/all' }));
      broadcastWs({ type: 'scanner:status', payload: getScannerStatus() });
    });

    upstream.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          channel?: string;
          market_stats?: Record<
            string,
            {
              symbol?: string;
              mark_price?: string | number;
              last_trade_price?: string | number;
              best_bid_price?: string | number;
              best_ask_price?: string | number;
              open_interest_usd?: string | number;
              current_funding_rate?: string | number;
              daily_price_change?: number;
              daily_quote_token_volume?: number;
            }
          >;
        };

        if (!msg.market_stats) return;

        const now = Date.now();
        botStore.lastTickAt = new Date(now).toISOString();

        // Build lookup of watched symbols by base asset
        const watchedByBase = new Map<string, FuturesSignal>();
        for (const sig of botStore.signals) {
          watchedByBase.set(sig.baseAsset.toUpperCase(), sig);
        }

        for (const stat of Object.values(msg.market_stats)) {
          const rawSym = stat.symbol?.toUpperCase();
          if (!rawSym) continue;

          // Match exact symbol (e.g. BTC, SOL) or 1000-prefixed Lighter markets (1000PEPE -> PEPE)
          let scale = 1;
          let matchedSig = watchedByBase.get(rawSym);
          if (!matchedSig && rawSym.startsWith('1000')) {
            matchedSig = watchedByBase.get(rawSym.slice(4));
            if (matchedSig) scale = 0.001;
          }
          if (!matchedSig) continue;

          const rawMark = Number(stat.last_trade_price ?? stat.mark_price ?? 0);
          if (!Number.isFinite(rawMark) || rawMark <= 0) continue;

          const livePrice = rawMark * scale;
          const bid = stat.best_bid_price !== undefined ? Number(stat.best_bid_price) * scale : null;
          const ask = stat.best_ask_price !== undefined ? Number(stat.best_ask_price) * scale : null;
          const oiUsd =
            stat.open_interest_usd !== undefined ? Number(stat.open_interest_usd) : null;
          const fundingPct =
            stat.current_funding_rate !== undefined ? Number(stat.current_funding_rate) : null;
          const change24h =
            typeof stat.daily_price_change === 'number'
              ? Number(stat.daily_price_change.toFixed(2))
              : matchedSig.priceChange24hPct;
          const vol24h =
            typeof stat.daily_quote_token_volume === 'number'
              ? stat.daily_quote_token_volume
              : matchedSig.quoteVolume24h;

          // Update server-authoritative signal snapshots across primary & cached MTF signals
          botStore.applyLiveTickToMtfSignals(
            matchedSig.symbol,
            livePrice,
            change24h,
            vol24h,
            fundingPct,
            oiUsd,
            bid,
            ask,
          );

          pendingTickMap.set(matchedSig.symbol, {
            symbol: matchedSig.symbol,
            lastPrice: livePrice,
            priceChange24hPct: change24h,
            quoteVolume24h: vol24h,
            fundingRatePct: matchedSig.fundingRatePct,
            openInterestUsd: matchedSig.openInterestUsd,
            bestBid: matchedSig.bestBid,
            bestAsk: matchedSig.bestAsk,
            updatedAt: now,
          });
        }
      } catch {
        // Ignore malformed tick frames
      }
    });

    upstream.on('close', () => {
      botStore.lighterStreamConnected = false;
      broadcastWs({ type: 'scanner:status', payload: getScannerStatus() });
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 4000);
      }
    });

    upstream.on('error', () => {
      upstream.close();
    });
  };

  connect();

  // Flush accumulated real-time Lighter ticks to browser WebSocket clients every 900ms
  setInterval(() => {
    if (pendingTickMap.size === 0) return;
    const ticks = Array.from(pendingTickMap.values());
    pendingTickMap.clear();
    const triggered = botStore.evaluateTickAlerts(ticks);
    const tickTradeAlarms = botStore.evaluateTradeAlarmsOnTicks(ticks);
    if (wssClients.size > 0) {
      broadcastWs({
        type: 'ticks',
        payload: {
          ticks,
          lastTickAt: botStore.lastTickAt,
          lighterStreamConnected: botStore.lighterStreamConnected,
        },
      });
      if (triggered.length > 0) {
        broadcastWs({
          type: 'alerts:triggered',
          payload: {
            events: triggered,
            alertRules: botStore.getAlertRules(),
            triggeredAlerts: botStore.getTriggeredAlerts(),
          },
        });
      }
      if (tickTradeAlarms.length > 0) {
        broadcastWs({
          type: 'tradeAlarms:triggered',
          payload: {
            events: tickTradeAlarms,
            activeTrades: botStore.getActiveTrades(),
            tradeAlarms: botStore.getTradeAlarms(),
          },
        });
      }
    }
  }, 900);
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws) => {
    wssClients.add(ws);
    const sentiment = await buildGlobalSentiment(botStore.signals, false);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'init',
          payload: {
            config: botStore.getConfig(),
            signals: botStore.signals,
            mtfSignals: botStore.getMtfSignalSummaries(),
            signalFeed: botStore.getSignalFeed(),
            scanner: getScannerStatus(),
            sentiment,
            alertRules: botStore.getAlertRules(),
            triggeredAlerts: botStore.getTriggeredAlerts(),
            activeTrades: botStore.getActiveTrades(),
            tradeAlarms: botStore.getTradeAlarms(),
          },
        }),
      );
    }

    ws.on('close', () => {
      wssClients.delete(ws);
    });
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      lighterStreamConnected: botStore.lighterStreamConnected,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/state', async (_req, res) => {
    const sentiment = await buildGlobalSentiment(botStore.signals, false);
    res.json({
      config: botStore.getConfig(),
      signals: botStore.signals,
      mtfSignals: botStore.getMtfSignalSummaries(),
      signalFeed: botStore.getSignalFeed(),
      scanner: getScannerStatus(),
      sentiment,
      alertRules: botStore.getAlertRules(),
      triggeredAlerts: botStore.getTriggeredAlerts(),
      activeTrades: botStore.getActiveTrades(),
      tradeAlarms: botStore.getTradeAlarms(),
    });
  });

  app.get('/api/signal', async (req, res) => {
    try {
      const symbolRaw = normalizeSymbol(String(req.query.symbol ?? ''));
      const tfRaw = String(req.query.timeframe ?? '').trim() as Timeframe;
      if (!symbolRaw || symbolRaw === 'USDC' || !ALL_TIMEFRAMES.includes(tfRaw)) {
        res.status(400).json({ ok: false, error: 'Valid symbol and timeframe are required.' });
        return;
      }

      const cached = botStore.getSignalForTimeframe(symbolRaw, tfRaw);
      if (cached) {
        res.json({ ok: true, signal: cached });
        return;
      }

      const config = botStore.getConfig();
      const snapshot = await fetchMarketSnapshot(symbolRaw, tfRaw, config.exchange, 220);
      const rawSignal = analyzeMarketSnapshot(snapshot, tfRaw, config.tradeMode, config.strongEntryOnly);
      const signal = botStore.applyPriorityFilter(rawSignal);
      res.json({ ok: true, signal });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to fetch timeframe signal.',
      });
    }
  });

  app.post('/api/scan', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        timeframe?: Timeframe;
        tradeMode?: TradeMode;
        exchange?: ExchangeFeed;
      };
      const result = await performMarketScan({
        timeframe: body.timeframe,
        tradeMode: body.tradeMode,
        exchange: body.exchange,
        forceQueue: true,
      });
      res.json({
        ok: true,
        config: botStore.getConfig(),
        signals: result.signals,
        mtfSignals: botStore.getMtfSignalSummaries(),
        failedSymbols: result.failedSymbols,
        scanner: getScannerStatus(),
        activeTrades: botStore.getActiveTrades(),
        tradeAlarms: botStore.getTradeAlarms(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Market scan failed.',
      });
    }
  });

  app.post('/api/config', async (req, res) => {
    try {
      const patch = (req.body ?? {}) as Record<string, unknown>;
      const updated = botStore.updateConfig(patch);
      if (Array.isArray(patch.watchlist) || patch.strongEntryOnly !== undefined) {
        botStore.invalidateOtherTimeframes();
      }
      if (updated.autoScanEnabled) {
        nextScanAtMs = Date.now() + updated.autoScanIntervalSeconds * 1000;
      } else {
        nextScanAtMs = null;
      }

      broadcastWs({
        type: 'config:update',
        payload: updated,
      });

      const priorityOrThresholdChanged =
        patch.priorityCoins !== undefined || patch.otherHighProbConfidence !== undefined;

      if (priorityOrThresholdChanged && botStore.signals.length > 0) {
        const addedFeed = botStore.recordActionableSignals(botStore.signals);
        const sentiment = await buildGlobalSentiment(botStore.signals, false);
        broadcastWs({
          type: 'signals:update',
          payload: {
            signals: botStore.signals,
            mtfSignals: botStore.getMtfSignalSummaries(),
            scanner: getScannerStatus(),
            addedFeed,
            sentiment,
            activeTrades: botStore.getActiveTrades(),
            tradeAlarms: botStore.getTradeAlarms(),
          },
        });
      }

      if (
        patch.perfectConfidence !== undefined ||
        patch.tradeAlarmsEnabled === true ||
        priorityOrThresholdChanged
      ) {
        const allImmediateAlarms = [];
        for (const tfSignals of botStore.signalsByTimeframe.values()) {
          if (tfSignals.length > 0) {
            allImmediateAlarms.push(...botStore.evaluateTradeAlarmsOnScan(tfSignals));
          }
        }
        if (allImmediateAlarms.length > 0) {
          broadcastWs({
            type: 'tradeAlarms:triggered',
            payload: {
              events: allImmediateAlarms,
              activeTrades: botStore.getActiveTrades(),
              tradeAlarms: botStore.getTradeAlarms(),
            },
          });
        }
      }

      res.json({
        ok: true,
        config: updated,
        signals: botStore.signals,
        mtfSignals: botStore.getMtfSignalSummaries(),
        scanner: getScannerStatus(),
        activeTrades: botStore.getActiveTrades(),
        tradeAlarms: botStore.getTradeAlarms(),
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid configuration.',
      });
    }
  });

  app.delete('/api/feed', (_req, res) => {
    botStore.clearSignalFeed();
    broadcastWs({ type: 'feed:cleared' });
    res.json({ ok: true });
  });

  app.post('/api/alerts', (req, res) => {
    const body = (req.body ?? {}) as {
      symbol?: string;
      condition?: AlertConditionType;
      threshold?: number;
      cooldownMinutes?: number;
    };
    const threshold = Number(body.threshold);
    if (!body.symbol || !body.condition || !Number.isFinite(threshold) || threshold <= 0) {
      res.status(400).json({ ok: false, error: 'Valid symbol, condition, and positive threshold are required.' });
      return;
    }

    const rule = botStore.addAlertRule({
      symbol: body.symbol,
      condition: body.condition,
      threshold,
      cooldownMinutes: body.cooldownMinutes,
    });

    // Immediately evaluate against current live signals so matching rules fire right away
    const immediateTriggers = botStore.evaluateScanAlerts(botStore.signals);

    broadcastWs({
      type: 'alerts:updated',
      payload: {
        alertRules: botStore.getAlertRules(),
        triggeredAlerts: botStore.getTriggeredAlerts(),
      },
    });
    if (immediateTriggers.length > 0) {
      broadcastWs({
        type: 'alerts:triggered',
        payload: {
          events: immediateTriggers,
          alertRules: botStore.getAlertRules(),
          triggeredAlerts: botStore.getTriggeredAlerts(),
        },
      });
    }

    res.json({
      ok: true,
      rule,
      alertRules: botStore.getAlertRules(),
      triggeredAlerts: botStore.getTriggeredAlerts(),
    });
  });

  app.patch('/api/alerts/:id', (req, res) => {
    const body = (req.body ?? {}) as { enabled?: boolean };
    const updated = botStore.toggleAlertRule(req.params.id, Boolean(body.enabled));
    if (!updated) {
      res.status(404).json({ ok: false, error: 'Alert rule not found.' });
      return;
    }
    broadcastWs({
      type: 'alerts:updated',
      payload: {
        alertRules: botStore.getAlertRules(),
        triggeredAlerts: botStore.getTriggeredAlerts(),
      },
    });
    res.json({ ok: true, rule: updated, alertRules: botStore.getAlertRules() });
  });

  app.delete('/api/alerts/:id', (req, res) => {
    const deleted = botStore.deleteAlertRule(req.params.id);
    if (!deleted) {
      res.status(404).json({ ok: false, error: 'Alert rule not found.' });
      return;
    }
    broadcastWs({
      type: 'alerts:updated',
      payload: {
        alertRules: botStore.getAlertRules(),
        triggeredAlerts: botStore.getTriggeredAlerts(),
      },
    });
    res.json({ ok: true, alertRules: botStore.getAlertRules() });
  });

  app.delete('/api/alerts', (_req, res) => {
    botStore.clearTriggeredAlerts();
    broadcastWs({
      type: 'alerts:updated',
      payload: {
        alertRules: botStore.getAlertRules(),
        triggeredAlerts: [],
      },
    });
    res.json({ ok: true });
  });

  app.post('/api/trade-alarms/ack', (req, res) => {
    const body = (req.body ?? {}) as { id?: string };
    const tradeAlarms = botStore.markTradeAlarmsRead(body.id);
    broadcastWs({
      type: 'tradeAlarms:updated',
      payload: {
        activeTrades: botStore.getActiveTrades(),
        tradeAlarms,
      },
    });
    res.json({ ok: true, tradeAlarms });
  });

  app.delete('/api/trade-alarms/:id', (req, res) => {
    const tradeAlarms = botStore.dismissTradeAlarm(req.params.id);
    broadcastWs({
      type: 'tradeAlarms:updated',
      payload: {
        activeTrades: botStore.getActiveTrades(),
        tradeAlarms,
      },
    });
    res.json({ ok: true, tradeAlarms });
  });

  app.delete('/api/trade-alarms', (_req, res) => {
    botStore.clearTradeAlarms();
    broadcastWs({
      type: 'tradeAlarms:updated',
      payload: {
        activeTrades: botStore.getActiveTrades(),
        tradeAlarms: [],
      },
    });
    res.json({ ok: true, tradeAlarms: [] });
  });

  app.post('/api/trade-alarms/close-trade/:symbol', (req, res) => {
    const tfParam = (req.query.timeframe as Timeframe | undefined) ??
      ((req.body as { timeframe?: Timeframe } | undefined)?.timeframe);
    const timeframe = tfParam && ALL_TIMEFRAMES.includes(tfParam) ? tfParam : undefined;
    const { activeTrades, alarm } = botStore.closeTrackedTrade(
      req.params.symbol.toUpperCase(),
      timeframe,
    );
    const tradeAlarms = botStore.getTradeAlarms();
    broadcastWs({
      type: 'tradeAlarms:updated',
      payload: {
        activeTrades,
        tradeAlarms,
      },
    });
    res.json({ ok: true, activeTrades, tradeAlarms, alarm });
  });

  // Periodic Background Signal Re-Evaluation Loop
  setInterval(() => {
    const config = botStore.getConfig();
    if (!config.autoScanEnabled || isScanning) return;
    const now = Date.now();
    if (nextScanAtMs === null) {
      nextScanAtMs = now + config.autoScanIntervalSeconds * 1000;
      return;
    }
    if (now >= nextScanAtMs) {
      performMarketScan().catch((err) => {
        console.error('Background live scan failed:', err);
      });
    }
  }, 5_000);

  // Start Lighter DEX live WebSocket stream & initial market scan
  startLighterLiveStream();
  performMarketScan().catch((err) => {
    console.error('Initial market scan failed:', err);
  });

  // Ensure toBaseAsset is retained in server imports
  void toBaseAsset;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true' ? { server } : false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build.');
      }
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AltPulse Futures Live Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
