export type Timeframe = '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
export const ALL_TIMEFRAMES: Timeframe[] = ['1d', '4h', '1h', '30m', '15m', '5m'];
export type TradeStyle = 'swing' | 'intraday' | 'scalp';
export type TradeMode = 'auto' | TradeStyle;
export type ExchangeFeed = 'lighter' | 'auto' | 'binance' | 'bybit' | 'okx';
export type SignalDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

export interface ChartCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
}

export interface IndicatorSummary {
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number | null;
  rsi14: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  prevMacdHistogram: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbPercentB: number;
  atr14: number;
  atrPct: number;
  volumeRatio: number;
  swingHigh: number;
  swingLow: number;
}

export interface SmcZoneBox {
  low: number;
  high: number;
}

export interface SmcAnalysis {
  entryZoneStatus: 'PERFECT_ZONE' | 'APPROACHING_ZONE' | 'EXTENDED_WAIT';
  inEntryZone: boolean;
  zoneLabel: string;
  zoneDistancePct: number;
  bullishOb: SmcZoneBox | null;
  bearishOb: SmcZoneBox | null;
  fvgZone: { type: 'BULLISH' | 'BEARISH'; low: number; high: number } | null;
  liquiditySweep: 'SSL_SWEEP' | 'BSL_SWEEP' | 'NONE';
  nearestBslPool: number | null;
  nearestSslPool: number | null;
  bosDirection: 'BULLISH_BOS' | 'BEARISH_BOS' | 'NONE';
  rejectionConfirmed: boolean;
  smcConfluenceScore: number;
}

export interface FuturesSignal {
  symbol: string;
  baseAsset: string;
  exchangeUsed: 'lighter' | 'binance' | 'bybit' | 'okx';
  timeframe: Timeframe;
  tradeStyle: TradeStyle;
  direction: SignalDirection;
  confidence: number;
  lastPrice: number;
  priceChange24hPct: number;
  quoteVolume24h: number;
  fundingRatePct: number | null;
  openInterestUsd: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  entryMin: number;
  entryMax: number;
  stopLoss: number;
  stopLossPct: number;
  tp1: number;
  tp1Pct: number;
  tp2: number;
  tp2Pct: number;
  tp3: number;
  tp3Pct: number;
  riskRewardRatio: number;
  suggestedLeverage: number;
  indicators: IndicatorSummary;
  smc?: SmcAnalysis;
  isPriorityCoin?: boolean;
  isHighProbability?: boolean;
  rawDirection?: SignalDirection;
  rawConfidence?: number;
  reasons: string[];
  chartCandles: ChartCandle[];
  generatedAt: string;
}

export interface TimeframeSignalSummary {
  symbol: string;
  baseAsset: string;
  exchangeUsed: 'lighter' | 'binance' | 'bybit' | 'okx';
  timeframe: Timeframe;
  tradeStyle: TradeStyle;
  direction: SignalDirection;
  confidence: number;
  lastPrice: number;
  priceChange24hPct: number;
  quoteVolume24h: number;
  entryMin: number;
  entryMax: number;
  stopLoss: number;
  stopLossPct: number;
  tp1: number;
  tp1Pct: number;
  tp2: number;
  tp2Pct: number;
  tp3: number;
  tp3Pct: number;
  riskRewardRatio: number;
  suggestedLeverage: number;
  rsi14: number;
  atrPct: number;
  volumeRatio: number;
  swingHigh: number;
  swingLow: number;
  inEntryZone?: boolean;
  entryZoneStatus?: 'PERFECT_ZONE' | 'APPROACHING_ZONE' | 'EXTENDED_WAIT';
  zoneLabel?: string;
  liquiditySweep?: 'SSL_SWEEP' | 'BSL_SWEEP' | 'NONE';
  smcConfluenceScore?: number;
  isPriorityCoin?: boolean;
  isHighProbability?: boolean;
  reasons: string[];
  generatedAt: string;
}

export type MtfSignalsMap = Record<string, Partial<Record<Timeframe, TimeframeSignalSummary>>>;

export interface LiveTickUpdate {
  symbol: string;
  lastPrice: number;
  priceChange24hPct: number;
  quoteVolume24h: number;
  fundingRatePct: number | null;
  openInterestUsd: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  updatedAt: number;
}

export interface SignalFeedEntry {
  id: string;
  symbol: string;
  baseAsset: string;
  exchangeUsed: 'lighter' | 'binance' | 'bybit' | 'okx';
  timeframe: Timeframe;
  tradeStyle: TradeStyle;
  direction: SignalDirection;
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  suggestedLeverage: number;
  riskRewardRatio: number;
  reasons: string[];
  priceHistory?: Array<{ t: number; p: number }>;
  timestamp: string;
}

export interface BotConfig {
  watchlist: string[];
  priorityCoins: string[];
  otherHighProbConfidence: number;
  timeframe: Timeframe;
  tradeMode: TradeMode;
  exchange: ExchangeFeed;
  minConfidence: number;
  perfectConfidence: number;
  strongEntryOnly: boolean;
  tradeAlarmsEnabled: boolean;
  autoScanEnabled: boolean;
  autoScanIntervalSeconds: number;
}

export interface ScannerStatus {
  isScanning: boolean;
  lastScanAt: string | null;
  nextScanAt: string | null;
  lastError: string | null;
  scannedCount: number;
  failedSymbols: string[];
  lighterStreamConnected: boolean;
  lastTickAt: string | null;
  mtfTimeframesReady?: Timeframe[];
}

export interface SentimentHistoryPoint {
  value: number;
  classification: string;
  timestamp: number;
}

export interface GlobalSentiment {
  fearGreedValue: number | null;
  fearGreedClassification: string | null;
  fearGreedHistory: SentimentHistoryPoint[];
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  bullishRatioPct: number;
  bullBearHistory: Array<{ timestamp: number; value: number }>;
  marketAvgRsi: number;
  updatedAt: string;
}

export type AlertConditionType = 'price_above' | 'price_below' | 'volume_spike';

export interface AlertRule {
  id: string;
  symbol: string;
  condition: AlertConditionType;
  threshold: number;
  enabled: boolean;
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
  createdAt: string;
}

export interface TriggeredAlertEvent {
  id: string;
  ruleId: string;
  symbol: string;
  condition: AlertConditionType;
  threshold: number;
  actualValue: number;
  message: string;
  timestamp: string;
}

export type TradeAlarmAction = 'BUY' | 'SELL' | 'CLOSE';

export type TradeAlarmReason =
  | 'PERFECT_SIGNAL'
  | 'TP_HIT'
  | 'STOP_LOSS_HIT'
  | 'SIGNAL_EXIT'
  | 'REVERSAL';

export interface ActiveTrackedTrade {
  symbol: string;
  baseAsset: string;
  direction: 'LONG' | 'SHORT';
  timeframe: Timeframe;
  tradeStyle: TradeStyle;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  confidence: number;
  openedAt: string;
}

export interface TradeAlarmNotification {
  id: string;
  action: TradeAlarmAction;
  reason: TradeAlarmReason;
  symbol: string;
  baseAsset: string;
  timeframe: Timeframe;
  tradeStyle: TradeStyle;
  price: number;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  confidence: number;
  pnlPct?: number;
  message: string;
  read: boolean;
  timestamp: string;
}

export interface AppStatePayload {
  config: BotConfig;
  signals: FuturesSignal[];
  mtfSignals: MtfSignalsMap;
  signalFeed: SignalFeedEntry[];
  scanner: ScannerStatus;
  sentiment: GlobalSentiment;
  alertRules: AlertRule[];
  triggeredAlerts: TriggeredAlertEvent[];
  activeTrades: ActiveTrackedTrade[];
  tradeAlarms: TradeAlarmNotification[];
}

export type ActiveTab = 'scanner' | 'positions' | 'feed' | 'watchlist';
