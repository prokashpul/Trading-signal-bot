import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  ListChecks,
  Menu,
  Radio,
  RefreshCw,
  TrendingUp,
  X,
} from 'lucide-react';
import { GlobalSentimentIndicator } from './components/GlobalSentimentIndicator';
import { LiveTradesPnlView } from './components/LiveTradesPnlView';
import { SignalDetailModal } from './components/SignalDetailModal';
import { SignalFeedView } from './components/SignalFeedView';
import { SignalScannerView } from './components/SignalScannerView';
import { TradeNotificationBar } from './components/TradeNotificationBar';
import { WatchlistView } from './components/WatchlistView';
import type {
  ActiveTab,
  ActiveTrackedTrade,
  AlertConditionType,
  AlertRule,
  AppStatePayload,
  BotConfig,
  ExchangeFeed,
  FuturesSignal,
  GlobalSentiment,
  LiveTickUpdate,
  MtfSignalsMap,
  ScannerStatus,
  SignalFeedEntry,
  Timeframe,
  TradeAlarmAction,
  TradeAlarmNotification,
  TradeMode,
  TriggeredAlertEvent,
} from './types';
import { formatRelativeTime } from './utils/format';

const NAV_ITEMS: Array<{
  id: ActiveTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'scanner', label: 'Live Signals', icon: Activity },
  { id: 'positions', label: 'Live PnL', icon: BarChart3 },
  { id: 'feed', label: 'Signal Feed', icon: TrendingUp },
  { id: 'watchlist', label: 'Watchlist', icon: ListChecks },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('scanner');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [appState, setAppState] = useState<AppStatePayload | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>('BTCUSDC');
  const [detailModalTarget, setDetailModalTarget] = useState<{
    symbol: string;
    timeframe?: Timeframe;
    feedEntry?: SignalFeedEntry | null;
  } | null>(null);
  const [isScanningLocal, setIsScanningLocal] = useState(false);
  const [isSavingWatchlist, setIsSavingWatchlist] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [priceFlashMap, setPriceFlashMap] = useState<Record<string, 'up' | 'down'>>({});
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const flashTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const soundEnabledRef = useRef(true);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const playTradeAlarmTone = useCallback((action: TradeAlarmAction | 'ALERT' = 'ALERT') => {
    if (!soundEnabledRef.current) return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const notes =
        action === 'BUY'
          ? [587.33, 880, 1174.66]
          : action === 'SELL'
            ? [783.99, 587.33, 440]
            : action === 'CLOSE'
              ? [659.25, 783.99, 1046.5]
              : [740, 980];

      notes.forEach((freq, idx) => {
        const startAt = ctx.currentTime + idx * 0.11;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = action === 'CLOSE' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, startAt);
        gain.gain.setValueAtTime(0.09, startAt);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.19);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + 0.2);
      });
    } catch {
      // Ignore audio autoplay restriction
    }
  }, []);

  const pushDesktopNotification = useCallback((alarm: TradeAlarmNotification) => {
    if (
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    ) {
      return;
    }
    try {
      const title =
        alarm.action === 'BUY'
          ? `BUY SIGNAL: ${alarm.baseAsset}/USDC`
          : alarm.action === 'SELL'
            ? `SELL SIGNAL: ${alarm.baseAsset}/USDC`
            : `CLOSE TRADE: ${alarm.baseAsset}/USDC`;
      new Notification(title, { body: alarm.message, tag: alarm.id });
    } catch {
      // Ignore notification error
    }
  }, []);

  const showToast = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const fetchInitialState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) return;
      const data = (await res.json()) as AppStatePayload;
      setAppState(data);
    } catch {
      // Retry via WebSocket
    }
  }, []);

  // Real-time WebSocket subscription to /ws for live Lighter ticks & signal updates
  useEffect(() => {
    fetchInitialState();

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connectWs = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            payload?: unknown;
          };

          if (msg.type === 'init' && msg.payload) {
            setAppState(msg.payload as AppStatePayload);
            return;
          }

          if (msg.type === 'config:update' && msg.payload) {
            const nextConfig = msg.payload as BotConfig;
            setAppState((prev) => (prev ? { ...prev, config: nextConfig } : prev));
            return;
          }

          if (msg.type === 'scanner:status' && msg.payload) {
            const nextScanner = msg.payload as ScannerStatus;
            setAppState((prev) => (prev ? { ...prev, scanner: nextScanner } : prev));
            return;
          }

          if (msg.type === 'signals:update' && msg.payload) {
            const data = msg.payload as {
              signals: FuturesSignal[];
              mtfSignals?: MtfSignalsMap;
              scanner: ScannerStatus;
              addedFeed?: SignalFeedEntry[];
              sentiment?: GlobalSentiment;
              activeTrades?: ActiveTrackedTrade[];
              tradeAlarms?: TradeAlarmNotification[];
            };
            setAppState((prev) => {
              if (!prev) return prev;
              const existingIds = new Set(prev.signalFeed.map((f) => f.id));
              const newEntries = (data.addedFeed ?? []).filter((f) => !existingIds.has(f.id));
              return {
                ...prev,
                signals: data.signals,
                mtfSignals: data.mtfSignals ?? prev.mtfSignals,
                scanner: data.scanner,
                sentiment: data.sentiment ?? prev.sentiment,
                activeTrades: data.activeTrades ?? prev.activeTrades,
                tradeAlarms: data.tradeAlarms ?? prev.tradeAlarms,
                signalFeed: [...newEntries, ...prev.signalFeed].slice(0, 200),
              };
            });
            return;
          }

          if (msg.type === 'mtf:update' && msg.payload) {
            const data = msg.payload as {
              timeframe: Timeframe;
              mtfSignals: MtfSignalsMap;
              addedFeed?: SignalFeedEntry[];
              scanner?: ScannerStatus;
            };
            setAppState((prev) => {
              if (!prev) return prev;
              const existingIds = new Set(prev.signalFeed.map((f) => f.id));
              const newEntries = (data.addedFeed ?? []).filter((f) => !existingIds.has(f.id));
              return {
                ...prev,
                mtfSignals: data.mtfSignals,
                scanner: data.scanner ?? prev.scanner,
                signalFeed: [...newEntries, ...prev.signalFeed].slice(0, 200),
              };
            });
            return;
          }

          if (msg.type === 'feed:cleared') {
            setAppState((prev) => (prev ? { ...prev, signalFeed: [] } : prev));
            return;
          }

          if (msg.type === 'alerts:updated' && msg.payload) {
            const data = msg.payload as {
              alertRules: AlertRule[];
              triggeredAlerts: TriggeredAlertEvent[];
            };
            setAppState((prev) =>
              prev
                ? {
                    ...prev,
                    alertRules: data.alertRules,
                    triggeredAlerts: data.triggeredAlerts,
                  }
                : prev,
            );
            return;
          }

          if (msg.type === 'alerts:triggered' && msg.payload) {
            const data = msg.payload as {
              events: TriggeredAlertEvent[];
              alertRules: AlertRule[];
              triggeredAlerts: TriggeredAlertEvent[];
            };
            setAppState((prev) =>
              prev
                ? {
                    ...prev,
                    alertRules: data.alertRules,
                    triggeredAlerts: data.triggeredAlerts,
                  }
                : prev,
            );
            if (data.events.length > 0) {
              playTradeAlarmTone('ALERT');
              showToast(true, `Alert: ${data.events[0].message}`);
            }
            return;
          }

          if (msg.type === 'tradeAlarms:updated' && msg.payload) {
            const data = msg.payload as {
              activeTrades: ActiveTrackedTrade[];
              tradeAlarms: TradeAlarmNotification[];
            };
            setAppState((prev) =>
              prev
                ? {
                    ...prev,
                    activeTrades: data.activeTrades,
                    tradeAlarms: data.tradeAlarms,
                  }
                : prev,
            );
            return;
          }

          if (msg.type === 'tradeAlarms:triggered' && msg.payload) {
            const data = msg.payload as {
              events: TradeAlarmNotification[];
              activeTrades: ActiveTrackedTrade[];
              tradeAlarms: TradeAlarmNotification[];
            };
            setAppState((prev) =>
              prev
                ? {
                    ...prev,
                    activeTrades: data.activeTrades,
                    tradeAlarms: data.tradeAlarms,
                  }
                : prev,
            );
            if (data.events.length > 0) {
              const topAlarm = data.events[0];
              playTradeAlarmTone(topAlarm.action);
              pushDesktopNotification(topAlarm);
              showToast(topAlarm.action !== 'CLOSE' || (topAlarm.pnlPct ?? 0) >= 0, topAlarm.message);
            }
            return;
          }

          if (msg.type === 'ticks' && msg.payload) {
            const tickData = msg.payload as {
              ticks: LiveTickUpdate[];
              lastTickAt: string | null;
              lighterStreamConnected: boolean;
            };

            setAppState((prev) => {
              if (!prev) return prev;
              const tickMap = new Map(tickData.ticks.map((t) => [t.symbol, t]));
              const nextFlashes: Record<string, 'up' | 'down'> = {};

              const nextSignals = prev.signals.map((sig) => {
                const tick = tickMap.get(sig.symbol);
                if (!tick) return sig;

                if (tick.lastPrice > sig.lastPrice) nextFlashes[sig.symbol] = 'up';
                else if (tick.lastPrice < sig.lastPrice) nextFlashes[sig.symbol] = 'down';

                const nextCandles = sig.chartCandles.length
                  ? sig.chartCandles.map((c, idx) =>
                      idx === sig.chartCandles.length - 1
                        ? {
                            ...c,
                            close: tick.lastPrice,
                            high: Math.max(c.high, tick.lastPrice),
                            low: Math.min(c.low, tick.lastPrice),
                          }
                        : c,
                    )
                  : sig.chartCandles;

                return {
                  ...sig,
                  lastPrice: tick.lastPrice,
                  priceChange24hPct: tick.priceChange24hPct,
                  quoteVolume24h: tick.quoteVolume24h,
                  fundingRatePct: tick.fundingRatePct,
                  openInterestUsd: tick.openInterestUsd,
                  bestBid: tick.bestBid,
                  bestAsk: tick.bestAsk,
                  chartCandles: nextCandles,
                };
              });

              if (Object.keys(nextFlashes).length > 0) {
                setPriceFlashMap((old) => ({ ...old, ...nextFlashes }));
                for (const sym of Object.keys(nextFlashes)) {
                  if (flashTimersRef.current[sym]) clearTimeout(flashTimersRef.current[sym]);
                  flashTimersRef.current[sym] = setTimeout(() => {
                    setPriceFlashMap((curr) => {
                      const copy = { ...curr };
                      delete copy[sym];
                      return copy;
                    });
                  }, 450);
                }
              }

              let nextMtfSignals = prev.mtfSignals;
              if (nextMtfSignals) {
                let mtfChanged = false;
                const copy: MtfSignalsMap = { ...nextMtfSignals };
                for (const tick of tickData.ticks) {
                  const symEntry = copy[tick.symbol];
                  if (!symEntry) continue;
                  mtfChanged = true;
                  const updatedSym: typeof symEntry = {};
                  for (const [tfKey, sum] of Object.entries(symEntry)) {
                    if (sum) {
                      updatedSym[tfKey as Timeframe] = {
                        ...sum,
                        lastPrice: tick.lastPrice,
                        priceChange24hPct: tick.priceChange24hPct,
                        quoteVolume24h: tick.quoteVolume24h,
                      };
                    }
                  }
                  copy[tick.symbol] = updatedSym;
                }
                if (mtfChanged) nextMtfSignals = copy;
              }

              return {
                ...prev,
                signals: nextSignals,
                mtfSignals: nextMtfSignals,
                scanner: {
                  ...prev.scanner,
                  lastTickAt: tickData.lastTickAt,
                  lighterStreamConnected: tickData.lighterStreamConnected,
                },
              };
            });
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!disposed) {
          reconnectTimer = setTimeout(connectWs, 2500);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connectWs();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [fetchInitialState]);

  const scanReqSeqRef = useRef(0);

  const triggerScan = useCallback(
    async (opts?: { timeframe?: Timeframe; tradeMode?: TradeMode; exchange?: ExchangeFeed }) => {
      const reqId = ++scanReqSeqRef.current;
      setIsScanningLocal(true);

      if (opts?.timeframe || opts?.tradeMode || opts?.exchange) {
        setAppState((prev) =>
          prev
            ? {
                ...prev,
                config: {
                  ...prev.config,
                  ...(opts.timeframe ? { timeframe: opts.timeframe } : {}),
                  ...(opts.tradeMode ? { tradeMode: opts.tradeMode } : {}),
                  ...(opts.exchange ? { exchange: opts.exchange } : {}),
                },
              }
            : prev,
        );
      }

      try {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opts ?? {}),
        });
        const data = (await res.json()) as {
          ok: boolean;
          error?: string;
          config?: BotConfig;
          signals?: FuturesSignal[];
          mtfSignals?: MtfSignalsMap;
          scanner?: ScannerStatus;
          activeTrades?: ActiveTrackedTrade[];
          tradeAlarms?: TradeAlarmNotification[];
        };
        if (!res.ok || !data.ok) {
          if (reqId === scanReqSeqRef.current) {
            showToast(false, data.error || 'Market scan failed.');
          }
          return;
        }
        if (reqId === scanReqSeqRef.current) {
          setAppState((prev) =>
            prev
              ? {
                  ...prev,
                  config: data.config ?? prev.config,
                  signals: data.signals ?? prev.signals,
                  mtfSignals: data.mtfSignals ?? prev.mtfSignals,
                  scanner: data.scanner ?? prev.scanner,
                  activeTrades: data.activeTrades ?? prev.activeTrades,
                  tradeAlarms: data.tradeAlarms ?? prev.tradeAlarms,
                }
              : prev,
          );
        }
      } catch (err) {
        if (reqId === scanReqSeqRef.current) {
          showToast(false, err instanceof Error ? err.message : 'Network error during scan.');
        }
      } finally {
        if (reqId === scanReqSeqRef.current) {
          setIsScanningLocal(false);
        }
      }
    },
    [showToast],
  );

  const updateConfig = useCallback(async (patch: Partial<BotConfig>) => {
    setAppState((prev) =>
      prev
        ? {
            ...prev,
            config: {
              ...prev.config,
              ...patch,
            },
          }
        : prev,
    );
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      config?: BotConfig;
      signals?: FuturesSignal[];
      mtfSignals?: MtfSignalsMap;
      scanner?: ScannerStatus;
      activeTrades?: ActiveTrackedTrade[];
      tradeAlarms?: TradeAlarmNotification[];
    };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Failed to update configuration.');
    }
    setAppState((prev) =>
      prev
        ? {
            ...prev,
            config: data.config ?? prev.config,
            signals: data.signals ?? prev.signals,
            mtfSignals: data.mtfSignals ?? prev.mtfSignals,
            scanner: data.scanner ?? prev.scanner,
            activeTrades: data.activeTrades ?? prev.activeTrades,
            tradeAlarms: data.tradeAlarms ?? prev.tradeAlarms,
          }
        : prev,
    );
  }, []);

  const handleTogglePriorityCoin = useCallback(
    async (symbol: string) => {
      if (!appState) return;
      const current = appState.config.priorityCoins ?? [];
      const exists = current.includes(symbol);
      const next = exists ? current.filter((s) => s !== symbol) : [...current, symbol];
      try {
        await updateConfig({ priorityCoins: next });
        const base = symbol.replace(/(USDC|USDT)$/, '');
        showToast(
          true,
          exists
            ? `${base}/USDC moved to Other Coins (High-Prob >= ${appState.config.otherHighProbConfidence ?? 90}% only).`
            : `${base}/USDC added to Selected Priority Coins.`,
        );
      } catch (err) {
        showToast(false, err instanceof Error ? err.message : 'Failed to update selected coins.');
      }
    },
    [appState, updateConfig, showToast],
  );

  const handleSaveWatchlist = useCallback(
    async (
      watchlist: string[],
      scanAfter: boolean,
      priorityCoins?: string[],
      otherHighProbConfidence?: number,
    ) => {
      setIsSavingWatchlist(true);
      try {
        await updateConfig({
          watchlist,
          ...(priorityCoins !== undefined ? { priorityCoins } : {}),
          ...(otherHighProbConfidence !== undefined ? { otherHighProbConfidence } : {}),
        });
        if (scanAfter) {
          await triggerScan();
          setActiveTab('scanner');
          showToast(
            true,
            `Watchlist (${watchlist.length}) & Selected (${priorityCoins?.length ?? appState?.config.priorityCoins.length ?? 0}) saved and scanned.`,
          );
        } else {
          showToast(true, `Watchlist & Priority Coins saved.`);
        }
      } catch (err) {
        showToast(false, err instanceof Error ? err.message : 'Failed to save watchlist.');
      } finally {
        setIsSavingWatchlist(false);
      }
    },
    [appState?.config.priorityCoins.length, updateConfig, triggerScan, showToast],
  );

  const handleClearFeed = useCallback(async () => {
    try {
      await fetch('/api/feed', { method: 'DELETE' });
      showToast(true, 'Signal feed cleared.');
    } catch {
      showToast(false, 'Failed to clear signal feed.');
    }
  }, [showToast]);

  const handleCreateAlert = useCallback(
    async (input: {
      symbol: string;
      condition: AlertConditionType;
      threshold: number;
      cooldownMinutes: number;
    }) => {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        alertRules?: AlertRule[];
        triggeredAlerts?: TriggeredAlertEvent[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to add alert rule.');
      }
      setAppState((prev) =>
        prev
          ? {
              ...prev,
              alertRules: data.alertRules ?? prev.alertRules,
              triggeredAlerts: data.triggeredAlerts ?? prev.triggeredAlerts,
            }
          : prev,
      );
      showToast(true, 'Alert rule created.');
    },
    [showToast],
  );

  const handleToggleAlert = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        const res = await fetch(`/api/alerts/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        });
        const data = (await res.json()) as { ok: boolean; alertRules?: AlertRule[] };
        if (res.ok && data.ok && data.alertRules) {
          setAppState((prev) => (prev ? { ...prev, alertRules: data.alertRules! } : prev));
        }
      } catch {
        showToast(false, 'Failed to update alert rule.');
      }
    },
    [showToast],
  );

  const handleDeleteAlert = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/alerts/${id}`, { method: 'DELETE' });
        const data = (await res.json()) as { ok: boolean; alertRules?: AlertRule[] };
        if (res.ok && data.ok && data.alertRules) {
          setAppState((prev) => (prev ? { ...prev, alertRules: data.alertRules! } : prev));
        }
      } catch {
        showToast(false, 'Failed to delete alert rule.');
      }
    },
    [showToast],
  );

  const handleClearTriggeredAlerts = useCallback(async () => {
    try {
      await fetch('/api/alerts', { method: 'DELETE' });
      setAppState((prev) => (prev ? { ...prev, triggeredAlerts: [] } : prev));
    } catch {
      showToast(false, 'Failed to clear triggered alerts.');
    }
  }, [showToast]);

  const handleAckTradeAlarm = useCallback(async (id?: string) => {
    try {
      const res = await fetch('/api/trade-alarms/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { id } : {}),
      });
      const data = (await res.json()) as { ok: boolean; tradeAlarms?: TradeAlarmNotification[] };
      if (res.ok && data.ok && data.tradeAlarms) {
        setAppState((prev) => (prev ? { ...prev, tradeAlarms: data.tradeAlarms! } : prev));
      }
    } catch {
      // Ignore network hiccup
    }
  }, []);

  const handleDismissTradeAlarm = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/trade-alarms/${id}`, { method: 'DELETE' });
      const data = (await res.json()) as { ok: boolean; tradeAlarms?: TradeAlarmNotification[] };
      if (res.ok && data.ok && data.tradeAlarms) {
        setAppState((prev) => (prev ? { ...prev, tradeAlarms: data.tradeAlarms! } : prev));
      }
    } catch {
      // Ignore network hiccup
    }
  }, []);

  const handleClearTradeAlarms = useCallback(async () => {
    try {
      await fetch('/api/trade-alarms', { method: 'DELETE' });
      setAppState((prev) => (prev ? { ...prev, tradeAlarms: [] } : prev));
    } catch {
      showToast(false, 'Failed to clear alarm notifications.');
    }
  }, [showToast]);

  const handleCloseTrackedTrade = useCallback(
    async (symbol: string, timeframe?: Timeframe) => {
      try {
        const qs = timeframe ? `?timeframe=${encodeURIComponent(timeframe)}` : '';
        const res = await fetch(`/api/trade-alarms/close-trade/${symbol}${qs}`, {
          method: 'POST',
        });
        const data = (await res.json()) as {
          ok: boolean;
          activeTrades?: ActiveTrackedTrade[];
          tradeAlarms?: TradeAlarmNotification[];
        };
        if (res.ok && data.ok) {
          setAppState((prev) =>
            prev
              ? {
                  ...prev,
                  activeTrades: data.activeTrades ?? prev.activeTrades,
                  tradeAlarms: data.tradeAlarms ?? prev.tradeAlarms,
                }
              : prev,
          );
          showToast(
            true,
            `Closed tracked setup for ${symbol.replace(/(USDC|USDT)$/, '')}/USDC${timeframe ? ` (${timeframe.toUpperCase()})` : ''}.`,
          );
        }
      } catch {
        showToast(false, 'Failed to close tracked setup.');
      }
    },
    [showToast],
  );

  const activeNav = NAV_ITEMS.find((n) => n.id === activeTab) ?? NAV_ITEMS[0];
  const isScanning = isScanningLocal || Boolean(appState?.scanner.isScanning);

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex">
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Sidebar Navigation */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-64 bg-[#0F1520] border-r border-slate-800 flex flex-col justify-between transition-transform duration-150 lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="h-14 px-5 border-b border-slate-800 flex items-center justify-between">
            <span className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
              AltPulse
            </span>
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40'
                  }`}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </span>
                  {item.id === 'positions' && appState && appState.activeTrades.length > 0 && (
                    <span className="font-mono tabular-nums text-[11px] text-emerald-400">
                      {appState.activeTrades.length}
                    </span>
                  )}
                  {item.id === 'feed' && appState && appState.signalFeed.length > 0 && (
                    <span className="font-mono tabular-nums text-[11px] text-slate-400">
                      {appState.signalFeed.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Real Live Stream & Auto-Scanner Status */}
        <div className="p-4 border-t border-slate-800 text-xs space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span>WebSocket</span>
            <span
              className={`inline-flex items-center gap-1 font-medium ${
                wsConnected && appState?.scanner.lighterStreamConnected
                  ? 'text-emerald-400'
                  : 'text-amber-400'
              }`}
            >
              <Radio className="w-3 h-3" />
              {wsConnected
                ? appState?.scanner.lighterStreamConnected
                  ? 'Lighter Live'
                  : 'Syncing'
                : 'Connecting'}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-400 font-mono tabular-nums text-[11px]">
            <span>Last Scan</span>
            <span className="text-slate-300">
              {formatRelativeTime(appState?.scanner.lastScanAt ?? null)}
            </span>
          </div>
          {appState?.config.autoScanEnabled && appState.scanner.nextScanAt && (
            <div className="flex items-center justify-between text-slate-400 font-mono tabular-nums text-[11px]">
              <span>Next Auto-Scan</span>
              <span className="text-sky-400">
                {formatRelativeTime(appState.scanner.nextScanAt)}
              </span>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Strict 3-Zone Top Bar */}
        <header className="h-14 px-4 lg:px-6 border-b border-slate-800 bg-[#0F1520] flex items-center justify-between gap-8 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden text-slate-300 hover:text-white cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-sm font-semibold text-slate-100 whitespace-nowrap shrink-0">
              {activeNav.label}
            </h1>
          </div>

          <GlobalSentimentIndicator sentiment={appState?.sentiment} />

          <div className="flex items-center shrink-0">
            <button
              type="button"
              disabled={isScanning}
              onClick={() => triggerScan()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              {isScanning ? 'Scanning...' : 'Scan Now'}
            </button>
          </div>
        </header>

        {appState && (
          <TradeNotificationBar
            tradeAlarms={appState.tradeAlarms ?? []}
            triggeredAlerts={appState.triggeredAlerts ?? []}
            activeTrades={appState.activeTrades ?? []}
            signals={appState.signals}
            priorityCoinsCount={appState.config.priorityCoins?.length ?? 0}
            otherHighProbConfidence={appState.config.otherHighProbConfidence ?? 90}
            perfectConfidence={appState.config.perfectConfidence ?? 80}
            tradeAlarmsEnabled={appState.config.tradeAlarmsEnabled ?? true}
            soundEnabled={soundEnabled}
            onToggleSound={setSoundEnabled}
            onTestAlarm={(action) => {
              playTradeAlarmTone(action);
              showToast(true, 'Trade alarm chime tested.');
            }}
            onToggleTradeAlarms={(enabled) =>
              updateConfig({ tradeAlarmsEnabled: enabled })
                .then(() =>
                  showToast(
                    true,
                    enabled
                      ? 'BUY / SELL / CLOSE trade alarms enabled.'
                      : 'Trade alarms paused.',
                  ),
                )
                .catch((err) => showToast(false, err.message))
            }
            onChangePerfectConfidence={(score) =>
              updateConfig({ perfectConfidence: score })
                .then(() => showToast(true, `Perfect signal alarm threshold set to >= ${score}%.`))
                .catch((err) => showToast(false, err.message))
            }
            onAckAlarm={handleAckTradeAlarm}
            onDismissAlarm={handleDismissTradeAlarm}
            onClearAlarms={handleClearTradeAlarms}
            onClearTriggeredAlerts={handleClearTriggeredAlerts}
            onCloseTrackedTrade={handleCloseTrackedTrade}
            onInspectSymbol={(sym, tf) => {
              setSelectedSymbol(sym);
              setDetailModalTarget({ symbol: sym, timeframe: tf });
            }}
          />
        )}

        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          {!appState ? (
            <div className="py-20 text-center text-sm text-slate-400">
              Connecting to live futures stream...
            </div>
          ) : (
            <>
              {activeTab === 'scanner' && (
                <SignalScannerView
                  signals={appState.signals}
                  mtfSignals={appState.mtfSignals ?? {}}
                  config={appState.config}
                  scanner={appState.scanner}
                  selectedSymbol={selectedSymbol}
                  priceFlashMap={priceFlashMap}
                  alertRules={appState.alertRules ?? []}
                  triggeredAlerts={appState.triggeredAlerts ?? []}
                  soundEnabled={soundEnabled}
                  onToggleSound={setSoundEnabled}
                  onCreateAlert={handleCreateAlert}
                  onToggleAlert={handleToggleAlert}
                  onDeleteAlert={handleDeleteAlert}
                  onClearTriggeredAlerts={handleClearTriggeredAlerts}
                  onSelectSymbol={setSelectedSymbol}
                  onTogglePriorityCoin={handleTogglePriorityCoin}
                  onChangeOtherHighProbConfidence={(score) =>
                    updateConfig({ otherHighProbConfidence: score })
                      .then(() =>
                        showToast(true, `Other Coins require High-Prob >= ${score}% to signal.`),
                      )
                      .catch((err) => showToast(false, err.message))
                  }
                  onOpenSignalDetail={(sym, tf) =>
                    setDetailModalTarget({ symbol: sym, timeframe: tf })
                  }
                  onChangeTimeframe={(tf) => triggerScan({ timeframe: tf })}
                  onChangeTradeMode={(mode) => triggerScan({ tradeMode: mode })}
                  onChangeExchange={(ex) => triggerScan({ exchange: ex })}
                  onChangeInterval={(sec) =>
                    updateConfig({ autoScanIntervalSeconds: sec }).catch((err) =>
                      showToast(false, err.message),
                    )
                  }
                  onChangeMinConfidence={(minConf) =>
                    updateConfig({ minConfidence: minConf }).catch((err) =>
                      showToast(false, err.message),
                    )
                  }
                  onToggleStrongEntryOnly={(enabled) =>
                    updateConfig({
                      strongEntryOnly: enabled,
                      minConfidence: enabled ? Math.max(80, appState.config.minConfidence) : 60,
                      perfectConfidence: enabled
                        ? Math.max(80, appState.config.perfectConfidence)
                        : 70,
                    })
                      .then(() => triggerScan())
                      .then(() =>
                        showToast(
                          true,
                          enabled
                            ? 'Strong Entry Only (80–100%) filter enabled across all timeframes.'
                            : 'Standard signal threshold enabled.',
                        ),
                      )
                      .catch((err) => showToast(false, err.message))
                  }
                  onToggleAutoScan={(enabled) =>
                    updateConfig({ autoScanEnabled: enabled })
                      .then(() =>
                        showToast(
                          true,
                          enabled ? 'Live auto-refresh enabled.' : 'Live auto-refresh paused.',
                        ),
                      )
                      .catch((err) => showToast(false, err.message))
                  }
                  onNavigateTab={setActiveTab}
                  onTriggerScan={() => triggerScan()}
                />
              )}

              {activeTab === 'positions' && (
                <LiveTradesPnlView
                  activeTrades={appState.activeTrades ?? []}
                  signals={appState.signals}
                  mtfSignals={appState.mtfSignals ?? {}}
                  priceFlashMap={priceFlashMap}
                  onInspectSymbol={(sym, tf) => {
                    setSelectedSymbol(sym);
                    setDetailModalTarget({ symbol: sym, timeframe: tf });
                  }}
                  onCloseTrackedTrade={handleCloseTrackedTrade}
                  onNavigateTab={setActiveTab}
                />
              )}

              {activeTab === 'feed' && (
                <SignalFeedView
                  feed={appState.signalFeed}
                  signals={appState.signals}
                  mtfSignals={appState.mtfSignals ?? {}}
                  activeTrades={appState.activeTrades ?? []}
                  priceFlashMap={priceFlashMap}
                  onClearFeed={handleClearFeed}
                  onCloseTrackedTrade={handleCloseTrackedTrade}
                  onInspectSignal={(sym, entry) => {
                    setSelectedSymbol(sym);
                    setDetailModalTarget({
                      symbol: sym,
                      timeframe: entry?.timeframe,
                      feedEntry: entry ?? null,
                    });
                  }}
                  onInspectSymbol={(sym, tf) => {
                    setSelectedSymbol(sym);
                    setDetailModalTarget({ symbol: sym, timeframe: tf });
                  }}
                  onNavigateTab={setActiveTab}
                />
              )}

              {activeTab === 'watchlist' && (
                <WatchlistView
                  config={appState.config}
                  isSaving={isSavingWatchlist}
                  onSaveWatchlist={handleSaveWatchlist}
                />
              )}
            </>
          )}
        </main>
      </div>

      {detailModalTarget && appState && (
        <SignalDetailModal
          symbol={detailModalTarget.symbol}
          initialTimeframe={detailModalTarget.timeframe}
          primarySignal={
            appState.signals.find((s) => s.symbol === detailModalTarget.symbol) ?? null
          }
          mtfMap={appState.mtfSignals?.[detailModalTarget.symbol]}
          feedEntry={detailModalTarget.feedEntry ?? null}
          onClose={() => setDetailModalTarget(null)}
          onOpenInScanner={
            activeTab !== 'scanner'
              ? (sym) => {
                  setSelectedSymbol(sym);
                  setActiveTab('scanner');
                }
              : undefined
          }
        />
      )}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 max-w-sm px-4 py-3 rounded-lg border text-xs shadow-lg flex items-center justify-between gap-3 ${
            toast.ok
              ? 'bg-[#131A26] border-emerald-500/40 text-emerald-300'
              : 'bg-[#131A26] border-rose-500/40 text-rose-300'
          }`}
        >
          <span>{toast.text}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-slate-100 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
