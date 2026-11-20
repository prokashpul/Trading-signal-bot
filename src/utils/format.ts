export function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return '0.00';
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (price >= 10) return price.toFixed(3);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(8);
}

export function formatCompactVolume(volumeUsd: number): string {
  if (!Number.isFinite(volumeUsd) || volumeUsd <= 0) return '$0';
  if (volumeUsd >= 1_000_000_000) return `$${(volumeUsd / 1_000_000_000).toFixed(2)}B`;
  if (volumeUsd >= 1_000_000) return `$${(volumeUsd / 1_000_000).toFixed(1)}M`;
  if (volumeUsd >= 1_000) return `$${(volumeUsd / 1_000).toFixed(0)}K`;
  return `$${volumeUsd.toFixed(0)}`;
}

export function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Never';
  const ts = new Date(isoString).getTime();
  if (!Number.isFinite(ts)) return 'Never';
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 0) {
    const absSec = Math.abs(diffSec);
    if (absSec < 60) return `in ${absSec}s`;
    return `in ${Math.ceil(absSec / 60)}m`;
  }
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

export function formatClockTime(isoOrMs: string | number): string {
  const date = new Date(isoOrMs);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatCandleTime(ms: number, timeframe: string): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '--';
  if (timeframe === '1d') {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  if (timeframe === '4h') {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' });
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
