import React, { useMemo, useState } from 'react';
import { Bell, Pause, Play, Plus, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import type {
  AlertConditionType,
  AlertRule,
  FuturesSignal,
  TriggeredAlertEvent,
} from '../types';
import { formatDateTime, formatPrice, formatRelativeTime } from '../utils/format';

interface AlertConfigPanelProps {
  watchlist: string[];
  signals: FuturesSignal[];
  selectedSymbol: string | null;
  alertRules: AlertRule[];
  triggeredAlerts: TriggeredAlertEvent[];
  soundEnabled: boolean;
  onToggleSound: (enabled: boolean) => void;
  onCreateAlert: (input: {
    symbol: string;
    condition: AlertConditionType;
    threshold: number;
    cooldownMinutes: number;
  }) => Promise<void>;
  onToggleAlert: (id: string, enabled: boolean) => Promise<void>;
  onDeleteAlert: (id: string) => Promise<void>;
  onClearTriggered: () => Promise<void>;
  onClose: () => void;
}

export const AlertConfigPanel: React.FC<AlertConfigPanelProps> = ({
  watchlist,
  signals,
  selectedSymbol,
  alertRules,
  triggeredAlerts,
  soundEnabled,
  onToggleSound,
  onCreateAlert,
  onToggleAlert,
  onDeleteAlert,
  onClearTriggered,
  onClose,
}) => {
  const defaultSym = selectedSymbol || watchlist[0] || 'BTCUSDC';
  const [symbol, setSymbol] = useState<string>('ALL');
  const [condition, setCondition] = useState<AlertConditionType>('volume_spike');
  const [threshold, setThreshold] = useState<string>('2.0');
  const [cooldownMinutes, setCooldownMinutes] = useState<number>(15);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedSignal = useMemo(() => {
    const target = symbol === 'ALL' ? defaultSym : symbol;
    return signals.find((s) => s.symbol === target) ?? null;
  }, [signals, symbol, defaultSym]);

  const handleConditionChange = (nextCond: AlertConditionType) => {
    setCondition(nextCond);
    setFormError(null);
    if (nextCond === 'volume_spike') {
      setThreshold('2.0');
    } else {
      const targetSym = symbol === 'ALL' ? defaultSym : symbol;
      if (symbol === 'ALL') {
        setSymbol(targetSym);
      }
      const sig = signals.find((s) => s.symbol === targetSym);
      if (sig) {
        const multiplier = nextCond === 'price_above' ? 1.02 : 0.98;
        setThreshold(String(Number((sig.lastPrice * multiplier).toFixed(sig.lastPrice >= 10 ? 2 : 4))));
      }
    }
  };

  const applyPreset = (preset: 'global_vol_2x' | 'selected_price_above' | 'selected_vol_2x') => {
    setFormError(null);
    if (preset === 'global_vol_2x') {
      setSymbol('ALL');
      setCondition('volume_spike');
      setThreshold('2.0');
      return;
    }
    const targetSym = defaultSym;
    const sig = signals.find((s) => s.symbol === targetSym);
    setSymbol(targetSym);
    if (preset === 'selected_vol_2x') {
      setCondition('volume_spike');
      setThreshold('2.0');
    } else {
      setCondition('price_above');
      if (sig) {
        setThreshold(String(Number((sig.lastPrice * 1.02).toFixed(sig.lastPrice >= 10 ? 2 : 4))));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numeric = Number(threshold);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setFormError('Enter a valid positive threshold value.');
      return;
    }
    if (condition !== 'volume_spike' && symbol === 'ALL') {
      setFormError('Select a specific coin for price alerts.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      await onCreateAlert({
        symbol,
        condition,
        threshold: numeric,
        cooldownMinutes,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create alert rule.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const describeRule = (r: AlertRule): string => {
    const pair = r.symbol === 'ALL' ? 'All Watchlist Pairs' : `${r.symbol.replace(/(USDC|USDT)$/, '')}/USDC`;
    if (r.condition === 'volume_spike') {
      return `${pair} · Volume >= ${r.threshold}x moving avg`;
    }
    if (r.condition === 'price_above') {
      return `${pair} · Price >= $${formatPrice(r.threshold)}`;
    }
    return `${pair} · Price <= $${formatPrice(r.threshold)}`;
  };

  return (
    <section className="bg-[#131A26] border border-slate-800 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Bell className="w-4 h-4 text-sky-400" />
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Custom Price &amp; Volume Alerts
            </h2>
            <p className="text-xs text-slate-400">
              Evaluated in real time on incoming Lighter WebSocket price ticks and market scans.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onToggleSound(!soundEnabled)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              soundEnabled
                ? 'bg-sky-500/10 border-sky-500/40 text-sky-300'
                : 'bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            Sound: {soundEnabled ? 'On' : 'Off'}
          </button>

          <button
            type="button"
            aria-label="Close alerts panel"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
        {/* Left: Create Alert Rule Form */}
        <form onSubmit={handleSubmit} className="lg:col-span-5 p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-slate-400">Presets:</span>
            <button
              type="button"
              onClick={() => applyPreset('global_vol_2x')}
              className="px-2 py-1 bg-[#0B0F17] border border-slate-800 hover:border-slate-700 text-slate-200 rounded transition-colors cursor-pointer"
            >
              Any Pair Vol &gt; 2x Avg
            </button>
            <button
              type="button"
              onClick={() => applyPreset('selected_vol_2x')}
              className="px-2 py-1 bg-[#0B0F17] border border-slate-800 hover:border-slate-700 text-slate-200 rounded transition-colors cursor-pointer"
            >
              {defaultSym.replace(/(USDC|USDT)$/, '')} Vol &gt; 2x Avg
            </button>
            <button
              type="button"
              onClick={() => applyPreset('selected_price_above')}
              className="px-2 py-1 bg-[#0B0F17] border border-slate-800 hover:border-slate-700 text-slate-200 rounded transition-colors cursor-pointer"
            >
              {defaultSym.replace(/(USDC|USDT)$/, '')} +2% Breakout
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Target Pair</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full bg-[#0B0F17] border border-slate-800 rounded-md px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
              >
                {condition === 'volume_spike' && (
                  <option value="ALL">All Watchlist Pairs</option>
                )}
                {watchlist.map((sym) => (
                  <option key={sym} value={sym}>
                    {sym.replace(/(USDC|USDT)$/, '')}/USDC
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Condition</label>
              <select
                value={condition}
                onChange={(e) => handleConditionChange(e.target.value as AlertConditionType)}
                className="w-full bg-[#0B0F17] border border-slate-800 rounded-md px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
              >
                <option value="volume_spike">Volume &ge; Nx Moving Avg</option>
                <option value="price_above">Price Rises Above ($)</option>
                <option value="price_below">Price Drops Below ($)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {condition === 'volume_spike' ? 'Volume Multiplier (x)' : 'Target Price (USD)'}
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={threshold}
                onChange={(e) => {
                  setThreshold(e.target.value);
                  if (formError) setFormError(null);
                }}
                placeholder={condition === 'volume_spike' ? '2.0' : '65000'}
                className="w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-slate-100 focus:outline-none focus:border-sky-500"
              />
              {selectedSignal && (
                <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1">
                  Current {selectedSignal.baseAsset}: ${formatPrice(selectedSignal.lastPrice)} · Vol{' '}
                  {selectedSignal.indicators.volumeRatio.toFixed(2)}x
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Cooldown</label>
              <select
                value={cooldownMinutes}
                onChange={(e) => setCooldownMinutes(Number(e.target.value))}
                className="w-full bg-[#0B0F17] border border-slate-800 rounded-md px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </div>
          </div>

          {formError && <p className="text-xs text-rose-400">{formError}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            {isSubmitting ? 'Adding Rule...' : 'Add Alert Rule'}
          </button>
        </form>

        {/* Right: Active Rules & Triggered Alerts Feed */}
        <div className="lg:col-span-7 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Active Rules */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">
                Active Rules ({alertRules.length})
              </span>
            </div>

            {alertRules.length === 0 ? (
              <div className="py-6 text-xs text-slate-400">
                No custom alerts configured yet. Use a preset or create a rule on the left.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80 max-h-52 overflow-y-auto pr-1">
                {alertRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="py-2 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div
                        className={`font-mono tabular-nums truncate ${
                          rule.enabled ? 'text-slate-100' : 'text-slate-500 line-through'
                        }`}
                      >
                        {describeRule(rule)}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                        {rule.lastTriggeredAt
                          ? `Fired ${formatRelativeTime(rule.lastTriggeredAt)}`
                          : `Watching · ${rule.cooldownMinutes}m cooldown`}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        aria-label={rule.enabled ? 'Pause rule' : 'Resume rule'}
                        onClick={() => onToggleAlert(rule.id, !rule.enabled)}
                        className="p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
                      >
                        {rule.enabled ? (
                          <Pause className="w-3.5 h-3.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label="Delete rule"
                        onClick={() => onDeleteAlert(rule.id)}
                        className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Triggered Alert History */}
          <div className="space-y-2.5 md:border-l md:border-slate-800 md:pl-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">
                Triggered Notifications ({triggeredAlerts.length})
              </span>
              {triggeredAlerts.length > 0 && (
                <button
                  type="button"
                  onClick={onClearTriggered}
                  className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            {triggeredAlerts.length === 0 ? (
              <div className="py-6 text-xs text-slate-400">
                Matching price crossings or volume spikes will notify you here immediately.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80 max-h-52 overflow-y-auto pr-1">
                {triggeredAlerts.map((ev) => (
                  <div key={ev.id} className="py-2 text-xs space-y-0.5">
                    <div className="text-amber-300 font-medium">{ev.message}</div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500">
                      {formatDateTime(ev.timestamp)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
