import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BellOff,
  BellRing,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  ActiveTrackedTrade,
  FuturesSignal,
  Timeframe,
  TradeAlarmAction,
  TradeAlarmNotification,
  TriggeredAlertEvent,
} from '../types';
import { formatPrice, formatRelativeTime } from '../utils/format';

interface TradeNotificationBarProps {
  tradeAlarms: TradeAlarmNotification[];
  triggeredAlerts: TriggeredAlertEvent[];
  activeTrades: ActiveTrackedTrade[];
  signals: FuturesSignal[];
  priorityCoinsCount: number;
  otherHighProbConfidence: number;
  perfectConfidence: number;
  tradeAlarmsEnabled: boolean;
  soundEnabled: boolean;
  onToggleSound: (enabled: boolean) => void;
  onTestAlarm: (action: TradeAlarmAction) => void;
  onToggleTradeAlarms: (enabled: boolean) => void;
  onChangePerfectConfidence: (score: number) => void;
  onAckAlarm: (id?: string) => void;
  onDismissAlarm: (id: string) => void;
  onClearAlarms: () => void;
  onClearTriggeredAlerts: () => void;
  onCloseTrackedTrade: (symbol: string, timeframe?: Timeframe) => void;
  onInspectSymbol: (symbol: string, timeframe?: Timeframe) => void;
}

type NoticeTab = 'ALL' | 'BUY' | 'SELL' | 'CLOSE' | 'ALERTS' | 'OPEN';

export const TradeNotificationBar: React.FC<TradeNotificationBarProps> = ({
  tradeAlarms,
  triggeredAlerts,
  activeTrades,
  signals,
  priorityCoinsCount,
  otherHighProbConfidence,
  perfectConfidence,
  tradeAlarmsEnabled,
  soundEnabled,
  onToggleSound,
  onTestAlarm,
  onToggleTradeAlarms,
  onChangePerfectConfidence,
  onAckAlarm,
  onDismissAlarm,
  onClearAlarms,
  onClearTriggeredAlerts,
  onCloseTrackedTrade,
  onInspectSymbol,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [activeNoticeTab, setActiveNoticeTab] = useState<NoticeTab>('ALL');
  const [browserPerm, setBrowserPerm] = useState<string>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
  );

  const unreadAlarms = useMemo(() => tradeAlarms.filter((a) => !a.read), [tradeAlarms]);
  const buyCount = useMemo(
    () => tradeAlarms.filter((a) => a.action === 'BUY').length,
    [tradeAlarms],
  );
  const sellCount = useMemo(
    () => tradeAlarms.filter((a) => a.action === 'SELL').length,
    [tradeAlarms],
  );
  const closeCount = useMemo(
    () => tradeAlarms.filter((a) => a.action === 'CLOSE').length,
    [tradeAlarms],
  );

  const filteredAlarms = useMemo(() => {
    if (activeNoticeTab === 'BUY' || activeNoticeTab === 'SELL' || activeNoticeTab === 'CLOSE') {
      return tradeAlarms.filter((a) => a.action === activeNoticeTab);
    }
    return tradeAlarms;
  }, [tradeAlarms, activeNoticeTab]);

  const livePriceMap = useMemo(
    () => new Map(signals.map((s) => [s.symbol, s.lastPrice])),
    [signals],
  );

  const requestDesktopPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const res = await Notification.requestPermission();
      setBrowserPerm(res);
    } catch {
      // Ignore permission rejection
    }
  };

  const getTone = (action: TradeAlarmAction) => {
    if (action === 'BUY') {
      return {
        labelText: 'text-emerald-400',
        rowTint: 'border-emerald-500/20',
        label: 'BUY',
        Icon: ArrowUpRight,
      };
    }
    if (action === 'SELL') {
      return {
        labelText: 'text-rose-400',
        rowTint: 'border-rose-500/20',
        label: 'SELL',
        Icon: ArrowDownRight,
      };
    }
    return {
      labelText: 'text-amber-300',
      rowTint: 'border-amber-500/20',
      label: 'CLOSE',
      Icon: CheckCircle2,
    };
  };

  const totalNotices = tradeAlarms.length + triggeredAlerts.length;

  return (
    <section
      aria-label="Signal Notice Bar"
      className="border-b border-slate-800 bg-[#0D131E]"
    >
      {/* Notice Bar Header & Filter Controls */}
      <div className="px-4 lg:px-6 py-2 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/70">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-100 whitespace-nowrap shrink-0">
            {unreadAlarms.length > 0 ? (
              <BellRing className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
            ) : tradeAlarmsEnabled ? (
              <Bell className="w-3.5 h-3.5 text-sky-400" />
            ) : (
              <BellOff className="w-3.5 h-3.5 text-slate-500" />
            )}
            <span>Notice Bar</span>
            {unreadAlarms.length > 0 && (
              <span className="font-mono tabular-nums text-[11px] text-sky-400">
                ({unreadAlarms.length} new)
              </span>
            )}
            <span className="hidden md:inline-block px-1.5 py-0.5 bg-[#0B0F17] border border-slate-800 rounded text-[10px] font-mono text-slate-400">
              ★ {priorityCoinsCount} Selected · Others High-Prob &ge;{otherHighProbConfidence}% · OB Gate
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-0.5 bg-[#0B0F17] border border-slate-800 rounded-md">
            {(
              [
                { id: 'ALL', label: `All (${tradeAlarms.length})` },
                { id: 'BUY', label: `BUY (${buyCount})` },
                { id: 'SELL', label: `SELL (${sellCount})` },
                { id: 'CLOSE', label: `CLOSE (${closeCount})` },
                { id: 'ALERTS', label: `Alerts (${triggeredAlerts.length})` },
                { id: 'OPEN', label: `Open (${activeTrades.length})` },
              ] as Array<{ id: NoticeTab; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveNoticeTab(tab.id);
                  if (!expanded) setExpanded(true);
                }}
                className={`px-2 py-0.5 text-[11px] font-mono tabular-nums rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeNoticeTab === tab.id
                    ? 'bg-slate-800 text-slate-100 font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onToggleTradeAlarms(!tradeAlarmsEnabled)}
            className={`px-2 py-1 rounded border text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              tradeAlarmsEnabled
                ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-300'
                : 'bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            Alarms: {tradeAlarmsEnabled ? 'On' : 'Off'}
          </button>

          <select
            aria-label="Strong Entry Alarm Threshold"
            value={perfectConfidence}
            onChange={(e) => onChangePerfectConfidence(Number(e.target.value))}
            className="bg-[#0B0F17] border border-slate-800 rounded px-2 py-1 text-[11px] font-mono tabular-nums text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            <option value={80}>Strong &ge; 80%</option>
            <option value={85}>Strong &ge; 85%</option>
            <option value={90}>Elite &ge; 90%</option>
            <option value={95}>Sniper &ge; 95%</option>
          </select>

          <button
            type="button"
            onClick={() => onToggleSound(!soundEnabled)}
            title={soundEnabled ? 'Mute alarm chime' : 'Enable alarm chime'}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              soundEnabled
                ? 'bg-sky-500/10 border-sky-500/35 text-sky-300'
                : 'bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{soundEnabled ? 'Sound' : 'Muted'}</span>
          </button>

          <button
            type="button"
            onClick={() => onTestAlarm('BUY')}
            className="hidden sm:inline-flex items-center px-2 py-1 bg-[#0B0F17] border border-slate-800 hover:border-slate-700 text-slate-300 rounded text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
          >
            Test Sound
          </button>

          {browserPerm === 'default' && (
            <button
              type="button"
              onClick={requestDesktopPermission}
              className="hidden md:inline-flex items-center px-2 py-1 bg-[#0B0F17] border border-slate-800 hover:border-sky-500/50 text-sky-300 rounded text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Desktop Push
            </button>
          )}

          {unreadAlarms.length > 0 && (
            <button
              type="button"
              onClick={() => onAckAlarm()}
              className="inline-flex items-center gap-1 px-2 py-1 bg-[#0B0F17] border border-slate-800 hover:border-slate-700 text-sky-300 rounded text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Check className="w-3 h-3" />
              Mark Read
            </button>
          )}

          {totalNotices > 0 && (
            <button
              type="button"
              onClick={() => {
                if (activeNoticeTab === 'ALERTS') onClearTriggeredAlerts();
                else onClearAlarms();
              }}
              className="inline-flex items-center gap-1 px-2 py-1 bg-[#0B0F17] border border-slate-800 hover:border-rose-500/40 text-slate-400 hover:text-rose-300 rounded text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          )}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse Notice Bar' : 'Expand Notice Bar'}
            className="inline-flex items-center gap-1 px-2 py-1 bg-[#0B0F17] border border-slate-800 hover:border-slate-700 text-slate-300 rounded text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
          >
            {expanded ? (
              <>
                Hide <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                Show ({totalNotices}) <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Always-Visible Notice Stream Inside the Notice Bar */}
      {expanded && (
        <div className="px-4 lg:px-6 py-2 bg-[#0B0F17]/70 max-h-40 overflow-y-auto">
          {activeNoticeTab === 'OPEN' ? (
            activeTrades.length === 0 ? (
              <div className="py-2 text-xs text-slate-400">
                No active open setups tracked right now. Open BUY/SELL setups appear here and trigger CLOSE notices on TP1, Stop Loss, or signal reversal.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/70">
                {activeTrades.map((trade) => {
                  const current = livePriceMap.get(trade.symbol) ?? trade.entryPrice;
                  const isLong = trade.direction === 'LONG';
                  const pnlPct =
                    trade.entryPrice > 0
                      ? ((isLong ? current - trade.entryPrice : trade.entryPrice - current) /
                          trade.entryPrice) *
                        100
                      : 0;
                  return (
                    <div
                      key={`${trade.symbol}-${trade.timeframe}`}
                      className="py-1.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono tabular-nums"
                    >
                      <button
                        type="button"
                        onClick={() => onInspectSymbol(trade.symbol, trade.timeframe)}
                        className="flex flex-wrap items-center gap-2.5 text-left min-w-0 flex-1 cursor-pointer hover:text-sky-300"
                      >
                        <span
                          className={`font-semibold ${
                            isLong ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {isLong ? 'BUY' : 'SELL'} {trade.baseAsset}/USDC
                        </span>
                        <span className="text-slate-400">
                          {trade.timeframe.toUpperCase()} · {trade.confidence}%
                        </span>
                        <span className="text-slate-300">
                          Entry ${formatPrice(trade.entryPrice)} · SL ${formatPrice(trade.stopLoss)} · TP1 ${formatPrice(trade.tp1)}
                        </span>
                        <span className={pnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          Live {pnlPct >= 0 ? '+' : ''}
                          {pnlPct.toFixed(2)}%
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onCloseTrackedTrade(trade.symbol, trade.timeframe)}
                        className="px-2 py-0.5 border border-slate-800 hover:border-amber-500/50 text-amber-300 rounded text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          ) : activeNoticeTab === 'ALERTS' ? (
            triggeredAlerts.length === 0 ? (
              <div className="py-2 text-xs text-slate-400">
                No custom price or volume spike alerts triggered yet. Configure custom rules from the Alerts button in Live Signals.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/70">
                {triggeredAlerts.map((ev) => (
                  <div
                    key={ev.id}
                    className="py-1.5 flex items-center justify-between gap-3 text-xs font-mono tabular-nums"
                  >
                    <button
                      type="button"
                      onClick={() => onInspectSymbol(ev.symbol)}
                      className="text-left text-amber-300 hover:text-amber-200 truncate cursor-pointer"
                    >
                      ALERT · {ev.message}
                    </button>
                    <span className="text-[11px] text-slate-500 whitespace-nowrap shrink-0">
                      {formatRelativeTime(ev.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )
          ) : filteredAlarms.length === 0 ? (
            <div className="py-2 text-xs text-slate-400">
              {tradeAlarmsEnabled
                ? `Strong Entry Mode (Score >= ${perfectConfidence}%) active across Top 50 coins & all 6 timeframes (1D–5m) — BUY / SELL notices fire ONLY on high-confluence Strong Entries.`
                : 'Trade alarms are currently paused. Turn Alarms On to receive live notices here.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {filteredAlarms.map((alarm) => {
                const tone = getTone(alarm.action);
                const Icon = tone.Icon;
                return (
                  <div
                    key={alarm.id}
                    className={`py-1.5 flex items-center justify-between gap-3 text-xs ${
                      !alarm.read ? 'bg-slate-800/30 px-2 -mx-2 rounded' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onInspectSymbol(alarm.symbol, alarm.timeframe);
                        if (!alarm.read) onAckAlarm(alarm.id);
                      }}
                      className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer group"
                    >
                      <span
                        className={`inline-flex items-center gap-1 font-semibold whitespace-nowrap shrink-0 ${tone.labelText}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {tone.label}
                      </span>

                      <span className="font-mono tabular-nums text-slate-200 group-hover:text-sky-300 truncate">
                        {alarm.message}
                      </span>

                      {!alarm.read && (
                        <span className="text-[10px] font-mono font-semibold text-sky-400 shrink-0">
                          NEW
                        </span>
                      )}
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="hidden sm:inline text-[11px] font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {formatRelativeTime(alarm.timestamp)}
                      </span>
                      {!alarm.read && (
                        <button
                          type="button"
                          aria-label="Mark notice read"
                          onClick={() => onAckAlarm(alarm.id)}
                          className="p-0.5 text-slate-400 hover:text-emerald-400 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label="Dismiss notice"
                        onClick={() => onDismissAlarm(alarm.id)}
                        className="p-0.5 text-slate-500 hover:text-rose-400 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
