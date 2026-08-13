const numberFormat = new Intl.NumberFormat('en-US');
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const currencyFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return numberFormat.format(Number(value));
}

export function formatCompact(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return compactFormat.format(Number(value));
}

export function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return currencyFormat.format(Number(value));
}

export function formatPercent(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return `${Number(value).toFixed(digits)}%`;
}

export function formatRatioAsPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

export function formatScore(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return Number(value).toFixed(digits);
}

export function formatMs(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return `${Number(value).toFixed(digits)} ms`;
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = Number(bytes);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatClock(isoString) {
  if (!isoString) return '--';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '--';
  return timeFormat.format(date);
}

export function formatDateTime(isoString) {
  if (!isoString) return '--';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '--';
  return dateTimeFormat.format(date);
}

export function formatRelative(isoString) {
  if (!isoString) return '--';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '--';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '--';
  const total = Math.max(Math.round(Number(seconds)), 0);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (minutes === 0) return `${remainder}s`;
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

export function titleCase(value) {
  if (!value) return '';
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
