import fs from 'fs';
import path from 'path';
import {
  ALL_TIMEFRAMES,
  type ActiveTrackedTrade,
  type AlertConditionType,
  type AlertRule,
  type BotConfig,
  type FuturesSignal,
  type LiveTickUpdate,
  type MtfSignalsMap,
  type SignalFeedEntry,
  type Timeframe,
  type TimeframeSignalSummary,
  type TradeAlarmAction,
  type TradeAlarmNotification,
  type TriggeredAlertEvent,
} from './types.ts';

const DATA_FILE = path.resolve(process.cwd(), '.bot-data.json');

export const DEFAULT_WATCHLIST: string[] = [
  'BTCUSDC', 'ETHUSDC', 'SOLUSDC', 'XRPUSDC', 'BNBUSDC',
  'DOGEUSDC', 'ADAUSDC', 'TRXUSDC', 'AVAXUSDC', 'LINKUSDC',
  'SUIUSDC', 'HYPEUSDC', 'NEARUSDC', 'LTCUSDC', 'BCHUSDC',
  'UNIUSDC', 'AAVEUSDC', 'PEPEUSDC', 'SHIBUSDC', 'DOTUSDC',
  'APTUSDC', 'ARBUSDC', 'OPUSDC', 'TAOUSDC', 'ICPUSDC',
  'POLUSDC', 'XLMUSDC', 'HBARUSDC', 'FILUSDC', 'ENAUSDC',
  'ONDOUSDC', 'WLDUSDC', 'TIAUSDC', 'SEIUSDC', 'JUPUSDC',
  'BONKUSDC', 'FLOKIUSDC', 'WIFUSDC', 'PENDLEUSDC', 'CRVUSDC',
  'LDOUSDC', 'ZROUSDC', 'STRKUSDC', 'EIGENUSDC', 'PYTHUSDC',
  'ETHFIUSDC', 'ZKUSDC', 'DYDXUSDC', 'XMRUSDC', 'ZECUSDC',
  'LITUSDC',
];

function toUsdcPair(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return '';
  if (cleaned === 'ALL') return 'ALL';
  if (cleaned.endsWith('USDC')) return cleaned;
  if (cleaned.endsWith('USDT')) return `${cleaned.slice(0, -4)}USDC`;
  return `${cleaned}USDC`;
}

export const DEFAULT_PRIORITY_COINS: string[] = [
  'BTCUSDC',
  'ETHUSDC',
  'SOLUSDC',
  'ARBUSDC',
  'SUIUSDC',
  'LITUSDC',
];

const CURRENT_WATCHLIST_VERSION = 4;
const CURRENT_POLICY_VERSION = 4;

interface PersistedState {
  watchlistVersion?: number;
  policyVersion?: number;
  config: BotConfig;
  signalFeed: SignalFeedEntry[];
  alertRules: AlertRule[];
  triggeredAlerts: TriggeredAlertEvent[];
  activeTrades: ActiveTrackedTrade[];
  tradeAlarms: TradeAlarmNotification[];
}

function getDefaultConfig(): BotConfig {
  return {
    watchlist: [...DEFAULT_WATCHLIST],
    priorityCoins: [...DEFAULT_PRIORITY_COINS],
    otherHighProbConfidence: 90,
    timeframe: '4h',
    tradeMode: 'swing',
    exchange: 'lighter',
    minConfidence: 80,
    perfectConfidence: 80,
    strongEntryOnly: true,
    tradeAlarmsEnabled: true,
    autoScanEnabled: true,
    autoScanIntervalSeconds: 60,
  };
}

class BotStore {
  private state: PersistedState;
  public signals: FuturesSignal[] = [];
  public signalsByTimeframe = new Map<Timeframe, FuturesSignal[]>();
  private signalBySymbolTimeframe = new Map<string, FuturesSignal>();
  public lastTfScanAt = new Map<Timeframe, number>();
  public lastScanAt: string | null = null;
  public lastError: string | null = null;
  public failedSymbols: string[] = [];
  public lighterStreamConnected = false;
  public lastTickAt: string | null = null;
  private lastFeedSignature = new Map<string, string>();
  private lastAlarmTimestamp = new Map<string, number>();

  constructor() {
    this.state = this.loadFromDisk();
    let needsSave = false;
    if (this.state.watchlistVersion !== CURRENT_WATCHLIST_VERSION) {
      this.state.watchlistVersion = CURRENT_WATCHLIST_VERSION;
      needsSave = true;
    }
    if (this.state.policyVersion !== CURRENT_POLICY_VERSION) {
      this.state.policyVersion = CURRENT_POLICY_VERSION;
      needsSave = true;
    }
    if (needsSave) {
      this.saveToDisk();
    }
  }

  private loadFromDisk(): PersistedState {
    const defaults = getDefaultConfig();
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PersistedState> & {
          config?: Partial<BotConfig> & { autoScanIntervalMinutes?: number };
        };
        const rawList = Array.isArray(parsed.config?.watchlist) && parsed.config.watchlist.length > 0
          ? parsed.config.watchlist.map(toUsdcPair).filter((s) => s && s !== 'ALL')
          : defaults.watchlist;

        const baseList = rawList.includes('BTCUSDC') ? rawList : ['BTCUSDC', ...rawList];
        const OLD_DEFAULT_SET = new Set([
          'BTCUSDC', 'ETHUSDC', 'SOLUSDC', 'XRPUSDC', 'BNBUSDC', 'ADAUSDC',
          'DOGEUSDC', 'AVAXUSDC', 'LINKUSDC', 'SUIUSDC', 'NEARUSDC', 'DOTUSDC',
          'APTUSDC', 'ARBUSDC', 'OPUSDC', 'INJUSDC', 'PEPEUSDC', 'FETUSDC',
          'RENDERUSDC', 'TONUSDC', 'LTCUSDC',
        ]);
        const customUserPairs = baseList.filter((s) => !OLD_DEFAULT_SET.has(s));
        const watchlist =
          parsed.watchlistVersion === CURRENT_WATCHLIST_VERSION
            ? Array.from(new Set(baseList))
            : Array.from(new Set([...DEFAULT_WATCHLIST, ...customUserPairs]));

        const isUpgradingPolicy = parsed.policyVersion !== CURRENT_POLICY_VERSION;
        const strongEntryOnly = isUpgradingPolicy
          ? true
          : typeof parsed.config?.strongEntryOnly === 'boolean'
            ? parsed.config.strongEntryOnly
            : defaults.strongEntryOnly;

        const rawMinConf =
          typeof parsed.config?.minConfidence === 'number'
            ? parsed.config.minConfidence
            : defaults.minConfidence;
        const rawPerfectConf =
          typeof parsed.config?.perfectConfidence === 'number'
            ? parsed.config.perfectConfidence
            : defaults.perfectConfidence;

        const rawPriority = Array.isArray(parsed.config?.priorityCoins)
          ? Array.from(
              new Set(
                parsed.config.priorityCoins
                  .map(toUsdcPair)
                  .filter((s) => Boolean(s) && s !== 'ALL'),
              ),
            )
          : defaults.priorityCoins;
        const otherHighProbConfidence =
          typeof parsed.config?.otherHighProbConfidence === 'number'
            ? Math.min(98, Math.max(85, parsed.config.otherHighProbConfidence))
            : defaults.otherHighProbConfidence;

        const mergedConfig: BotConfig = {
          watchlist,
          priorityCoins: rawPriority,
          otherHighProbConfidence,
          timeframe: parsed.config?.timeframe ?? defaults.timeframe,
          tradeMode: parsed.config?.tradeMode ?? defaults.tradeMode,
          exchange: parsed.config?.exchange ?? defaults.exchange,
          minConfidence: isUpgradingPolicy
            ? 80
            : strongEntryOnly
              ? Math.max(80, rawMinConf)
              : rawMinConf,
          perfectConfidence: isUpgradingPolicy
            ? 80
            : strongEntryOnly
              ? Math.max(80, rawPerfectConf)
              : rawPerfectConf,
          strongEntryOnly,
          tradeAlarmsEnabled:
            typeof parsed.config?.tradeAlarmsEnabled === 'boolean'
              ? parsed.config.tradeAlarmsEnabled
              : defaults.tradeAlarmsEnabled,
          autoScanEnabled:
            typeof parsed.config?.autoScanEnabled === 'boolean'
              ? parsed.config.autoScanEnabled
              : defaults.autoScanEnabled,
          autoScanIntervalSeconds:
            typeof parsed.config?.autoScanIntervalSeconds === 'number'
              ? parsed.config.autoScanIntervalSeconds
              : defaults.autoScanIntervalSeconds,
        };

        const rawFeed = (Array.isArray(parsed.signalFeed) ? parsed.signalFeed : []).map((f) => ({
          ...f,
          symbol: toUsdcPair(f.symbol),
        }));
        const rawActive = (Array.isArray(parsed.activeTrades) ? parsed.activeTrades : []).map((t) => ({
          ...t,
          symbol: toUsdcPair(t.symbol),
        }));
        const rawAlarms = (Array.isArray(parsed.tradeAlarms) ? parsed.tradeAlarms : []).map((a) => ({
          ...a,
          symbol: toUsdcPair(a.symbol),
          message: a.message.replace(/\/USDT\b/g, '/USDC'),
        }));
        const rawRules = (Array.isArray(parsed.alertRules) ? parsed.alertRules : []).map((r) => ({
          ...r,
          symbol: r.symbol === 'ALL' ? 'ALL' : toUsdcPair(r.symbol),
        }));
        const rawTriggered = (Array.isArray(parsed.triggeredAlerts) ? parsed.triggeredAlerts : []).map((ev) => ({
          ...ev,
          symbol: ev.symbol === 'ALL' ? 'ALL' : toUsdcPair(ev.symbol),
          message: ev.message.replace(/\/USDT\b/g, '/USDC'),
        }));

        return {
          watchlistVersion: parsed.watchlistVersion,
          policyVersion: parsed.policyVersion,
          config: mergedConfig,
          signalFeed: (isUpgradingPolicy
            ? rawFeed.filter((f) => f.confidence >= 80)
            : rawFeed
          ).slice(0, 200),
          alertRules: rawRules,
          triggeredAlerts: rawTriggered.slice(0, 100),
          activeTrades: isUpgradingPolicy
            ? rawActive.filter((t) => t.confidence >= 80)
            : rawActive,
          tradeAlarms: (isUpgradingPolicy
            ? rawAlarms.filter((a) => a.confidence >= 80)
            : rawAlarms
          ).slice(0, 150),
        };
      }
    } catch {
      // Fallback cleanly
    }
    return {
      watchlistVersion: CURRENT_WATCHLIST_VERSION,
      policyVersion: CURRENT_POLICY_VERSION,
      config: defaults,
      signalFeed: [],
      alertRules: [],
      triggeredAlerts: [],
      activeTrades: [],
      tradeAlarms: [],
    };
  }

  private saveToDisk(): void {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist state:', err);
    }
  }

  getConfig(): BotConfig {
    return this.state.config;
  }

  updateConfig(patch: Partial<BotConfig>): BotConfig {
    const current = this.state.config;
    const nextWatchlist = Array.isArray(patch.watchlist)
      ? Array.from(
          new Set(
            patch.watchlist
              .map(toUsdcPair)
              .filter((s) => Boolean(s) && s !== 'ALL'),
          ),
        )
      : current.watchlist;

    const nextStrongOnly =
      typeof patch.strongEntryOnly === 'boolean'
        ? patch.strongEntryOnly
        : current.strongEntryOnly;
    const minAllowed = nextStrongOnly ? 80 : 55;

    const rawMin =
      typeof patch.minConfidence === 'number'
        ? Math.min(95, Math.max(minAllowed, patch.minConfidence))
        : Math.max(minAllowed, current.minConfidence);
    const rawPerfect =
      typeof patch.perfectConfidence === 'number'
        ? Math.min(95, Math.max(minAllowed, patch.perfectConfidence))
        : Math.max(minAllowed, current.perfectConfidence);

    const nextPriority = Array.isArray(patch.priorityCoins)
      ? Array.from(
          new Set(
            patch.priorityCoins
              .map(toUsdcPair)
              .filter((s) => Boolean(s) && s !== 'ALL'),
          ),
        )
      : current.priorityCoins;
    const nextOtherHighProb =
      typeof patch.otherHighProbConfidence === 'number'
        ? Math.min(98, Math.max(85, patch.otherHighProbConfidence))
        : current.otherHighProbConfidence;

    this.state.config = {
      ...current,
      ...patch,
      watchlist: nextWatchlist.length > 0 ? nextWatchlist : current.watchlist,
      priorityCoins: nextPriority,
      otherHighProbConfidence: nextOtherHighProb,
      strongEntryOnly: nextStrongOnly,
      minConfidence: rawMin,
      perfectConfidence: rawPerfect,
      tradeAlarmsEnabled:
        typeof patch.tradeAlarmsEnabled === 'boolean'
          ? patch.tradeAlarmsEnabled
          : current.tradeAlarmsEnabled,
      autoScanIntervalSeconds:
        typeof patch.autoScanIntervalSeconds === 'number'
          ? Math.min(900, Math.max(15, patch.autoScanIntervalSeconds))
          : current.autoScanIntervalSeconds,
    };

    if (patch.priorityCoins !== undefined || patch.otherHighProbConfidence !== undefined) {
      this.reapplyPriorityFilterAcrossCache();
    }

    this.saveToDisk();
    return this.state.config;
  }

  applyPriorityFilter(sig: FuturesSignal): FuturesSignal {
    const prioritySet = new Set(this.state.config.priorityCoins);
    const isPriorityCoin = prioritySet.has(sig.symbol);
    const highProbMin = Math.max(85, Math.min(98, this.state.config.otherHighProbConfidence || 90));
    const rawDir = sig.rawDirection ?? sig.direction;
    const rawConf = sig.rawConfidence ?? sig.confidence;
    const baseReasons = sig.baseReasons ?? sig.reasons;
    const inZone = sig.smc ? sig.smc.inEntryZone : true;
    const isHighProbability = rawDir !== 'NEUTRAL' && inZone && rawConf >= highProbMin;

    if (isPriorityCoin) {
      sig.direction = rawDir;
      sig.confidence = rawConf;
      sig.reasons = baseReasons;
      sig.isPriorityCoin = true;
      sig.isHighProbability = isHighProbability;
      return sig;
    }

    if (isHighProbability) {
      sig.direction = rawDir;
      sig.confidence = rawConf;
      sig.isPriorityCoin = false;
      sig.isHighProbability = true;
      sig.reasons = [
        `HIGH-PROBABILITY (${rawConf}% >= ${highProbMin}%) NON-LISTED SETUP`,
        ...baseReasons,
      ];
      return sig;
    }

    sig.isPriorityCoin = false;
    sig.isHighProbability = false;
    if (rawDir !== 'NEUTRAL') {
      sig.direction = 'NEUTRAL';
      sig.confidence = Math.min(rawConf, highProbMin - 1);
      sig.reasons = [
        `Non-Selected Coin Filtered (${rawConf}% < ${highProbMin}% High-Prob bar — Star ★ coin for ${this.state.config.minConfidence}%+ signals)`,
        ...baseReasons.slice(0, 1),
      ];
    } else {
      sig.direction = 'NEUTRAL';
      sig.confidence = rawConf;
      sig.reasons = baseReasons;
    }
    return sig;
  }

  reapplyPriorityFilterAcrossCache(): void {
    for (const [tf, list] of this.signalsByTimeframe.entries()) {
      const updated = list.map((sig) => {
        const res = this.applyPriorityFilter(sig);
        this.signalBySymbolTimeframe.set(`${res.symbol}:${tf}`, res);
        return res;
      });
      updated.sort((a, b) => {
        const aActive = a.direction !== 'NEUTRAL' ? 1 : 0;
        const bActive = b.direction !== 'NEUTRAL' ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        if (a.confidence !== b.confidence) return b.confidence - a.confidence;
        return b.quoteVolume24h - a.quoteVolume24h;
      });
      this.signalsByTimeframe.set(tf, updated);
      if (tf === this.state.config.timeframe) {
        this.signals = updated;
      }
    }
  }

  setTimeframeSignals(timeframe: Timeframe, signals: FuturesSignal[]): void {
    const filtered = signals.map((sig) => this.applyPriorityFilter(sig));
    filtered.sort((a, b) => {
      const aActive = a.direction !== 'NEUTRAL' ? 1 : 0;
      const bActive = b.direction !== 'NEUTRAL' ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      if (a.riskRewardRatio !== b.riskRewardRatio) return b.riskRewardRatio - a.riskRewardRatio;
      return b.quoteVolume24h - a.quoteVolume24h;
    });
    this.signalsByTimeframe.set(timeframe, filtered);
    this.lastTfScanAt.set(timeframe, Date.now());
    for (const sig of filtered) {
      this.signalBySymbolTimeframe.set(`${sig.symbol}:${timeframe}`, sig);
    }
    if (timeframe === this.state.config.timeframe) {
      this.signals = filtered;
    }
  }

  invalidateOtherTimeframes(keepTf?: Timeframe): void {
    for (const tf of ALL_TIMEFRAMES) {
      if (tf !== keepTf) {
        this.lastTfScanAt.delete(tf);
      }
    }
  }

  getSignalForTimeframe(symbol: string, timeframe: Timeframe): FuturesSignal | null {
    return this.signalBySymbolTimeframe.get(`${symbol}:${timeframe}`) ?? null;
  }

  getReadyTimeframes(): Timeframe[] {
    return ALL_TIMEFRAMES.filter((tf) => {
      const list = this.signalsByTimeframe.get(tf);
      return Array.isArray(list) && list.length > 0;
    });
  }

  toTimeframeSummary(sig: FuturesSignal): TimeframeSignalSummary {
    return {
      symbol: sig.symbol,
      baseAsset: sig.baseAsset,
      exchangeUsed: sig.exchangeUsed,
      timeframe: sig.timeframe,
      tradeStyle: sig.tradeStyle,
      direction: sig.direction,
      confidence: sig.confidence,
      lastPrice: sig.lastPrice,
      priceChange24hPct: sig.priceChange24hPct,
      quoteVolume24h: sig.quoteVolume24h,
      entryMin: sig.entryMin,
      entryMax: sig.entryMax,
      stopLoss: sig.stopLoss,
      stopLossPct: sig.stopLossPct,
      tp1: sig.tp1,
      tp1Pct: sig.tp1Pct,
      tp2: sig.tp2,
      tp2Pct: sig.tp2Pct,
      tp3: sig.tp3,
      tp3Pct: sig.tp3Pct,
      riskRewardRatio: sig.riskRewardRatio,
      suggestedLeverage: sig.suggestedLeverage,
      rsi14: sig.indicators.rsi14,
      atrPct: sig.indicators.atrPct,
      volumeRatio: sig.indicators.volumeRatio,
      swingHigh: sig.indicators.swingHigh,
      swingLow: sig.indicators.swingLow,
      inEntryZone: sig.smc?.inEntryZone ?? sig.direction !== 'NEUTRAL',
      entryZoneStatus: sig.smc?.entryZoneStatus,
      zoneLabel: sig.smc?.zoneLabel,
      liquiditySweep: sig.smc?.liquiditySweep,
      smcConfluenceScore: sig.smc?.smcConfluenceScore,
      isPriorityCoin: sig.isPriorityCoin,
      isHighProbability: sig.isHighProbability,
      reasons: sig.reasons,
      generatedAt: sig.generatedAt,
    };
  }

  getMtfSignalSummaries(): MtfSignalsMap {
    const allowed = new Set(this.state.config.watchlist);
    const out: MtfSignalsMap = {};
    for (const tf of ALL_TIMEFRAMES) {
      const list = this.signalsByTimeframe.get(tf);
      if (!list) continue;
      for (const sig of list) {
        if (!allowed.has(sig.symbol)) continue;
        if (!out[sig.symbol]) out[sig.symbol] = {};
        out[sig.symbol][tf] = this.toTimeframeSummary(sig);
      }
    }
    return out;
  }

  applyLiveTickToMtfSignals(
    symbol: string,
    livePrice: number,
    change24h: number,
    vol24h: number,
    fundingPct: number | null,
    oiUsd: number | null,
    bid: number | null,
    ask: number | null,
  ): void {
    for (const tf of ALL_TIMEFRAMES) {
      const sig = this.signalBySymbolTimeframe.get(`${symbol}:${tf}`);
      if (!sig) continue;
      sig.lastPrice = livePrice;
      sig.priceChange24hPct = change24h;
      sig.quoteVolume24h = vol24h;
      if (livePrice > 0) {
        sig.stopLossPct = Number(Math.abs(((sig.stopLoss - livePrice) / livePrice) * 100).toFixed(2));
        sig.tp1Pct = Number(Math.abs(((sig.tp1 - livePrice) / livePrice) * 100).toFixed(2));
        sig.tp2Pct = Number(Math.abs(((sig.tp2 - livePrice) / livePrice) * 100).toFixed(2));
        sig.tp3Pct = Number(Math.abs(((sig.tp3 - livePrice) / livePrice) * 100).toFixed(2));
        // Keep institutional Order Block / FVG entryMin & entryMax anchored; update live zone distance
        if (sig.smc) {
          if (livePrice > sig.entryMax) {
            sig.smc.zoneDistancePct = Number((((livePrice - sig.entryMax) / livePrice) * 100).toFixed(2));
          } else if (livePrice < sig.entryMin) {
            sig.smc.zoneDistancePct = Number((((sig.entryMin - livePrice) / livePrice) * 100).toFixed(2));
          } else {
            sig.smc.zoneDistancePct = 0;
          }
        }
      }
      if (fundingPct !== null && Number.isFinite(fundingPct)) {
        sig.fundingRatePct = Number(fundingPct.toFixed(4));
      }
      if (oiUsd !== null && Number.isFinite(oiUsd)) {
        sig.openInterestUsd = oiUsd;
      }
      if (bid !== null && Number.isFinite(bid)) sig.bestBid = bid;
      if (ask !== null && Number.isFinite(ask)) sig.bestAsk = ask;
      const lastCandle = sig.chartCandles[sig.chartCandles.length - 1];
      if (lastCandle) {
        lastCandle.close = livePrice;
        if (livePrice > lastCandle.high) lastCandle.high = livePrice;
        if (livePrice < lastCandle.low) lastCandle.low = livePrice;
      }
    }
  }

  getSignalFeed(): SignalFeedEntry[] {
    return this.state.signalFeed;
  }

  recordActionableSignals(signals: FuturesSignal[]): SignalFeedEntry[] {
    const added: SignalFeedEntry[] = [];
    const minConf = this.state.config.strongEntryOnly
      ? Math.max(80, this.state.config.minConfidence)
      : this.state.config.minConfidence;

    for (const sig of signals) {
      const key = `${sig.symbol}:${sig.timeframe}`;
      const isZonePerfect = sig.smc ? sig.smc.inEntryZone : true;
      const isEligibleCoin = Boolean(sig.isPriorityCoin || sig.isHighProbability);
      if (sig.direction === 'NEUTRAL' || sig.confidence < minConf || !isZonePerfect || !isEligibleCoin) {
        if (sig.direction === 'NEUTRAL') {
          this.lastFeedSignature.set(key, 'NEUTRAL');
        }
        continue;
      }

      const prevSig = this.lastFeedSignature.get(key);
      // Record only when entering a fresh Perfect Zone direction
      if (prevSig === sig.direction) continue;

      this.lastFeedSignature.set(key, sig.direction);
      const entry: SignalFeedEntry = {
        id: `${sig.symbol}-${sig.timeframe}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        symbol: sig.symbol,
        baseAsset: sig.baseAsset,
        exchangeUsed: sig.exchangeUsed,
        timeframe: sig.timeframe,
        tradeStyle: sig.tradeStyle,
        direction: sig.direction,
        confidence: sig.confidence,
        entryPrice: sig.lastPrice,
        stopLoss: sig.stopLoss,
        tp1: sig.tp1,
        tp2: sig.tp2,
        tp3: sig.tp3,
        suggestedLeverage: sig.suggestedLeverage,
        riskRewardRatio: sig.riskRewardRatio,
        reasons: sig.reasons,
        priceHistory: sig.chartCandles.slice(-28).map((c) => ({ t: c.timestamp, p: c.close })),
        timestamp: new Date().toISOString(),
      };
      added.push(entry);
    }

    if (added.length > 0) {
      this.state.signalFeed = [...added, ...this.state.signalFeed].slice(0, 200);
      this.saveToDisk();
    }
    return added;
  }

  clearSignalFeed(): void {
    this.state.signalFeed = [];
    this.lastFeedSignature.clear();
    this.saveToDisk();
  }

  getAlertRules(): AlertRule[] {
    return this.state.alertRules;
  }

  getTriggeredAlerts(): TriggeredAlertEvent[] {
    return this.state.triggeredAlerts;
  }

  addAlertRule(input: {
    symbol: string;
    condition: AlertConditionType;
    threshold: number;
    cooldownMinutes?: number;
  }): AlertRule {
    const symbol = toUsdcPair(input.symbol);

    const rule: AlertRule = {
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      symbol,
      condition: input.condition,
      threshold: Number(input.threshold),
      enabled: true,
      cooldownMinutes: Math.min(240, Math.max(1, input.cooldownMinutes ?? 15)),
      lastTriggeredAt: null,
      createdAt: new Date().toISOString(),
    };

    this.state.alertRules = [rule, ...this.state.alertRules];
    this.saveToDisk();
    return rule;
  }

  toggleAlertRule(id: string, enabled: boolean): AlertRule | null {
    const rule = this.state.alertRules.find((r) => r.id === id);
    if (!rule) return null;
    rule.enabled = enabled;
    this.saveToDisk();
    return rule;
  }

  deleteAlertRule(id: string): boolean {
    const before = this.state.alertRules.length;
    this.state.alertRules = this.state.alertRules.filter((r) => r.id !== id);
    if (this.state.alertRules.length !== before) {
      this.saveToDisk();
      return true;
    }
    return false;
  }

  clearTriggeredAlerts(): void {
    this.state.triggeredAlerts = [];
    this.saveToDisk();
  }

  private isRuleReady(rule: AlertRule): boolean {
    if (!rule.enabled) return false;
    if (!rule.lastTriggeredAt) return true;
    const lastMs = new Date(rule.lastTriggeredAt).getTime();
    return Date.now() - lastMs >= rule.cooldownMinutes * 60_000;
  }

  evaluateTickAlerts(ticks: LiveTickUpdate[]): TriggeredAlertEvent[] {
    if (this.state.alertRules.length === 0 || ticks.length === 0) return [];
    const triggered: TriggeredAlertEvent[] = [];
    const nowIso = new Date().toISOString();

    for (const rule of this.state.alertRules) {
      if (rule.condition === 'volume_spike' || !this.isRuleReady(rule)) continue;
      for (const tick of ticks) {
        if (rule.symbol !== 'ALL' && rule.symbol !== tick.symbol) continue;
        const hit =
          (rule.condition === 'price_above' && tick.lastPrice >= rule.threshold) ||
          (rule.condition === 'price_below' && tick.lastPrice <= rule.threshold);
        if (hit) {
          rule.lastTriggeredAt = nowIso;
          const base = tick.symbol.replace(/(USDC|USDT)$/, '');
          const verb = rule.condition === 'price_above' ? 'crossed above' : 'dropped below';
          triggered.push({
            id: `trig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ruleId: rule.id,
            symbol: tick.symbol,
            condition: rule.condition,
            threshold: rule.threshold,
            actualValue: tick.lastPrice,
            message: `${base}/USDC ${verb} $${rule.threshold} (live $${tick.lastPrice})`,
            timestamp: nowIso,
          });
          break;
        }
      }
    }

    if (triggered.length > 0) {
      this.state.triggeredAlerts = [...triggered, ...this.state.triggeredAlerts].slice(0, 100);
      this.saveToDisk();
    }
    return triggered;
  }

  evaluateScanAlerts(signals: FuturesSignal[]): TriggeredAlertEvent[] {
    if (this.state.alertRules.length === 0 || signals.length === 0) return [];
    const triggered: TriggeredAlertEvent[] = [];
    const nowIso = new Date().toISOString();

    for (const rule of this.state.alertRules) {
      if (!this.isRuleReady(rule)) continue;
      for (const sig of signals) {
        if (rule.symbol !== 'ALL' && rule.symbol !== sig.symbol) continue;

        let hit = false;
        let actual = sig.lastPrice;
        let msg = '';

        if (rule.condition === 'volume_spike' && sig.indicators.volumeRatio >= rule.threshold) {
          hit = true;
          actual = sig.indicators.volumeRatio;
          msg = `${sig.baseAsset}/USDC volume reached ${sig.indicators.volumeRatio.toFixed(2)}x moving avg (alert >= ${rule.threshold}x)`;
        } else if (rule.condition === 'price_above' && sig.lastPrice >= rule.threshold) {
          hit = true;
          actual = sig.lastPrice;
          msg = `${sig.baseAsset}/USDC crossed above $${rule.threshold} (now $${sig.lastPrice})`;
        } else if (rule.condition === 'price_below' && sig.lastPrice <= rule.threshold) {
          hit = true;
          actual = sig.lastPrice;
          msg = `${sig.baseAsset}/USDC dropped below $${rule.threshold} (now $${sig.lastPrice})`;
        }

        if (hit) {
          rule.lastTriggeredAt = nowIso;
          triggered.push({
            id: `trig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ruleId: rule.id,
            symbol: sig.symbol,
            condition: rule.condition,
            threshold: rule.threshold,
            actualValue: actual,
            message: msg,
            timestamp: nowIso,
          });
          if (rule.symbol !== 'ALL') break;
          if (triggered.length >= 5) break;
        }
      }
    }

    if (triggered.length > 0) {
      this.state.triggeredAlerts = [...triggered, ...this.state.triggeredAlerts].slice(0, 100);
      this.saveToDisk();
    }
    return triggered;
  }

  getActiveTrades(): ActiveTrackedTrade[] {
    return this.state.activeTrades;
  }

  getTradeAlarms(): TradeAlarmNotification[] {
    return this.state.tradeAlarms;
  }

  private canEmitAlarm(symbol: string, timeframe: Timeframe, action: TradeAlarmAction): boolean {
    const key = `${symbol}:${timeframe}:${action}`;
    const prev = this.lastAlarmTimestamp.get(key) ?? 0;
    if (Date.now() - prev < 900_000) return false; // 15m anti-spam guard per coin+timeframe+action
    this.lastAlarmTimestamp.set(key, Date.now());
    return true;
  }

  private formatAlarmPrice(price: number): string {
    if (!Number.isFinite(price)) return '0';
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 10) return price.toFixed(3);
    if (price >= 1) return price.toFixed(4);
    if (price >= 0.01) return price.toFixed(5);
    return price.toFixed(8);
  }

  evaluateTradeAlarmsOnScan(signals: FuturesSignal[]): TradeAlarmNotification[] {
    if (!this.state.config.tradeAlarmsEnabled || signals.length === 0) return [];

    const perfectMin = this.state.config.strongEntryOnly
      ? Math.max(80, this.state.config.perfectConfidence)
      : this.state.config.perfectConfidence;
    const activeMap = new Map(
      this.state.activeTrades.map((t) => [`${t.symbol}:${t.timeframe}`, t]),
    );
    const newAlarms: TradeAlarmNotification[] = [];
    let stateMutated = false;

    for (const sig of signals) {
      const tradeKey = `${sig.symbol}:${sig.timeframe}`;
      const existing = activeMap.get(tradeKey);

      if (existing) {
        const isLong = existing.direction === 'LONG';
        const pnlPct =
          existing.entryPrice > 0
            ? Number(
                (
                  ((isLong ? sig.lastPrice - existing.entryPrice : existing.entryPrice - sig.lastPrice) /
                    existing.entryPrice) *
                  100
                ).toFixed(2),
              )
            : 0;

        const hitSl = isLong ? sig.lastPrice <= existing.stopLoss : sig.lastPrice >= existing.stopLoss;
        const hitTp = isLong ? sig.lastPrice >= existing.tp1 : sig.lastPrice <= existing.tp1;
        const reversedPerfect =
          sig.direction !== 'NEUTRAL' &&
          sig.direction !== existing.direction &&
          sig.confidence >= perfectMin;
        const weakenedExit =
          sig.timeframe === existing.timeframe &&
          ((sig.direction !== 'NEUTRAL' && sig.direction !== existing.direction) ||
            sig.confidence < 60);

        if (hitSl || hitTp || reversedPerfect || weakenedExit) {
          const reason = hitTp
            ? 'TP_HIT'
            : hitSl
              ? 'STOP_LOSS_HIT'
              : reversedPerfect
                ? 'REVERSAL'
                : 'SIGNAL_EXIT';

          activeMap.delete(tradeKey);
          stateMutated = true;

          if (this.canEmitAlarm(sig.symbol, existing.timeframe, 'CLOSE')) {
            const reasonLabel =
              reason === 'TP_HIT'
                ? 'TP1 Target Hit'
                : reason === 'STOP_LOSS_HIT'
                  ? 'Stop Loss Hit'
                  : reason === 'REVERSAL'
                    ? `Signal Reversed to ${sig.direction}`
                    : 'Trend Exhausted / Neutral';

            newAlarms.push({
              id: `alarm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              action: 'CLOSE',
              reason,
              symbol: sig.symbol,
              baseAsset: sig.baseAsset,
              timeframe: existing.timeframe,
              tradeStyle: existing.tradeStyle,
              price: sig.lastPrice,
              entryPrice: existing.entryPrice,
              stopLoss: existing.stopLoss,
              tp1: existing.tp1,
              tp2: existing.tp2,
              confidence: sig.confidence,
              pnlPct,
              message: `CLOSE ${existing.direction} (${existing.timeframe.toUpperCase()}) · ${sig.baseAsset}/USDC @ $${this.formatAlarmPrice(sig.lastPrice)} (${reasonLabel} · ${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`,
              read: false,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      // Open BUY or SELL alarm ONLY when price is confirmed inside Perfect Entry Zone AND passes Priority / High-Prob gate
      const inPerfectZone = sig.smc ? sig.smc.inEntryZone : true;
      const passesPriorityGate = Boolean(sig.isPriorityCoin || sig.isHighProbability);
      if (
        !activeMap.has(tradeKey) &&
        sig.direction !== 'NEUTRAL' &&
        sig.confidence >= perfectMin &&
        inPerfectZone &&
        passesPriorityGate
      ) {
        const action: TradeAlarmAction = sig.direction === 'LONG' ? 'BUY' : 'SELL';
        const trade: ActiveTrackedTrade = {
          symbol: sig.symbol,
          baseAsset: sig.baseAsset,
          direction: sig.direction,
          timeframe: sig.timeframe,
          tradeStyle: sig.tradeStyle,
          entryPrice: sig.lastPrice,
          stopLoss: sig.stopLoss,
          tp1: sig.tp1,
          tp2: sig.tp2,
          tp3: sig.tp3,
          confidence: sig.confidence,
          openedAt: new Date().toISOString(),
        };
        activeMap.set(tradeKey, trade);
        stateMutated = true;

        if (this.canEmitAlarm(sig.symbol, sig.timeframe, action)) {
          const zoneSuffix = sig.smc?.zoneLabel ? ` · ${sig.smc.zoneLabel}` : '';
          const tierTag = sig.isPriorityCoin ? '[SELECTED]' : '[HIGH PROB]';
          newAlarms.push({
            id: `alarm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            action,
            reason: 'PERFECT_SIGNAL',
            symbol: sig.symbol,
            baseAsset: sig.baseAsset,
            timeframe: sig.timeframe,
            tradeStyle: sig.tradeStyle,
            price: sig.lastPrice,
            entryPrice: sig.lastPrice,
            stopLoss: sig.stopLoss,
            tp1: sig.tp1,
            tp2: sig.tp2,
            confidence: sig.confidence,
            message: `${tierTag} ${action} PERFECT ZONE · ${sig.baseAsset}/USDC (${sig.confidence}% · ${sig.timeframe.toUpperCase()}${zoneSuffix}) @ $${this.formatAlarmPrice(sig.lastPrice)} · SL $${this.formatAlarmPrice(sig.stopLoss)} · TP1 $${this.formatAlarmPrice(sig.tp1)}`,
            read: false,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    if (stateMutated || newAlarms.length > 0) {
      this.state.activeTrades = Array.from(activeMap.values());
      if (newAlarms.length > 0) {
        this.state.tradeAlarms = [...newAlarms, ...this.state.tradeAlarms].slice(0, 150);
      }
      this.saveToDisk();
    }

    return newAlarms;
  }

  evaluateTradeAlarmsOnTicks(ticks: LiveTickUpdate[]): TradeAlarmNotification[] {
    if (!this.state.config.tradeAlarmsEnabled || this.state.activeTrades.length === 0 || ticks.length === 0) {
      return [];
    }

    const tickMap = new Map(ticks.map((t) => [t.symbol, t]));
    const remaining: ActiveTrackedTrade[] = [];
    const newAlarms: TradeAlarmNotification[] = [];
    let mutated = false;

    for (const trade of this.state.activeTrades) {
      const tick = tickMap.get(trade.symbol);
      if (!tick) {
        remaining.push(trade);
        continue;
      }

      const isLong = trade.direction === 'LONG';
      const hitSl = isLong ? tick.lastPrice <= trade.stopLoss : tick.lastPrice >= trade.stopLoss;
      const hitTp = isLong ? tick.lastPrice >= trade.tp1 : tick.lastPrice <= trade.tp1;

      if (hitSl || hitTp) {
        mutated = true;
        const pnlPct =
          trade.entryPrice > 0
            ? Number(
                (
                  ((isLong ? tick.lastPrice - trade.entryPrice : trade.entryPrice - tick.lastPrice) /
                    trade.entryPrice) *
                  100
                ).toFixed(2),
              )
            : 0;
        const reason = hitTp ? 'TP_HIT' : 'STOP_LOSS_HIT';
        if (this.canEmitAlarm(trade.symbol, trade.timeframe, 'CLOSE')) {
          newAlarms.push({
            id: `alarm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            action: 'CLOSE',
            reason,
            symbol: trade.symbol,
            baseAsset: trade.baseAsset,
            timeframe: trade.timeframe,
            tradeStyle: trade.tradeStyle,
            price: tick.lastPrice,
            entryPrice: trade.entryPrice,
            stopLoss: trade.stopLoss,
            tp1: trade.tp1,
            tp2: trade.tp2,
            confidence: trade.confidence,
            pnlPct,
            message: `CLOSE ${trade.direction} (${trade.timeframe.toUpperCase()}) · ${trade.baseAsset}/USDC @ $${this.formatAlarmPrice(tick.lastPrice)} (${hitTp ? 'TP1 Target Hit' : 'Stop Loss Hit'} · ${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`,
            read: false,
            timestamp: new Date().toISOString(),
          });
        }
      } else {
        remaining.push(trade);
      }
    }

    if (mutated || newAlarms.length > 0) {
      this.state.activeTrades = remaining;
      if (newAlarms.length > 0) {
        this.state.tradeAlarms = [...newAlarms, ...this.state.tradeAlarms].slice(0, 150);
      }
      this.saveToDisk();
    }

    return newAlarms;
  }

  markTradeAlarmsRead(id?: string): TradeAlarmNotification[] {
    let changed = false;
    this.state.tradeAlarms = this.state.tradeAlarms.map((a) => {
      if (!id || a.id === id) {
        if (!a.read) changed = true;
        return { ...a, read: true };
      }
      return a;
    });
    if (changed) this.saveToDisk();
    return this.state.tradeAlarms;
  }

  dismissTradeAlarm(id: string): TradeAlarmNotification[] {
    const before = this.state.tradeAlarms.length;
    this.state.tradeAlarms = this.state.tradeAlarms.filter((a) => a.id !== id);
    if (this.state.tradeAlarms.length !== before) this.saveToDisk();
    return this.state.tradeAlarms;
  }

  clearTradeAlarms(): void {
    this.state.tradeAlarms = [];
    this.saveToDisk();
  }

  closeTrackedTrade(
    symbol: string,
    timeframe?: Timeframe,
  ): {
    activeTrades: ActiveTrackedTrade[];
    alarm: TradeAlarmNotification | null;
  } {
    const idx = this.state.activeTrades.findIndex(
      (t) => t.symbol === symbol && (!timeframe || t.timeframe === timeframe),
    );
    if (idx === -1) {
      return { activeTrades: this.state.activeTrades, alarm: null };
    }
    const trade = this.state.activeTrades[idx];
    this.state.activeTrades = this.state.activeTrades.filter((_, i) => i !== idx);
    const liveSig =
      this.getSignalForTimeframe(symbol, trade.timeframe) ??
      this.signals.find((s) => s.symbol === symbol);
    const exitPrice = liveSig?.lastPrice ?? trade.entryPrice;
    const isLong = trade.direction === 'LONG';
    const pnlPct =
      trade.entryPrice > 0
        ? Number(
            (
              ((isLong ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice) /
                trade.entryPrice) *
              100
            ).toFixed(2),
          )
        : 0;
    const alarm: TradeAlarmNotification = {
      id: `alarm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action: 'CLOSE',
      reason: 'SIGNAL_EXIT',
      symbol: trade.symbol,
      baseAsset: trade.baseAsset,
      timeframe: trade.timeframe,
      tradeStyle: trade.tradeStyle,
      price: exitPrice,
      entryPrice: trade.entryPrice,
      stopLoss: trade.stopLoss,
      tp1: trade.tp1,
      tp2: trade.tp2,
      confidence: trade.confidence,
      pnlPct,
      message: `CLOSE ${trade.direction} (${trade.timeframe.toUpperCase()}) · ${trade.baseAsset}/USDC @ $${this.formatAlarmPrice(exitPrice)} (Manual Exit · ${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`,
      read: true,
      timestamp: new Date().toISOString(),
    };
    this.state.tradeAlarms = [alarm, ...this.state.tradeAlarms].slice(0, 150);
    this.saveToDisk();
    return { activeTrades: this.state.activeTrades, alarm };
  }
}

export const botStore = new BotStore();
