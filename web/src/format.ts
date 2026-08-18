export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * "12 min ago", "3 hr ago", "5 days ago".
 *
 * Used wherever staleness is the point — a position fix or an engine event is only
 * meaningful relative to now, and an absolute timestamp makes the reader do the
 * subtraction. Future timestamps read as "just now" rather than "in 3 minutes";
 * a small clock skew between the car and this machine is not worth reporting.
 */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '—';

  const seconds = (Date.now() - then.getTime()) / 1000;
  if (seconds < 90) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Watt-hours to kilowatt-hours, for display only. */
export function kwh(wattHours: number | null | undefined, digits = 2): string {
  if (wattHours === null || wattHours === undefined) return '—';
  return formatNumber(wattHours / 1000, digits);
}
