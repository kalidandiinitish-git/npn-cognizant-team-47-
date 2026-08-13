/**
 * Risk band presentation, mirroring the engine's bands
 * (ml-engine/src/config.py RISK_BANDS).
 */
export const RISK_LEVELS = {
  low: {
    label: 'Low',
    range: '0.00 - 0.39',
    action: 'Allow',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-500',
    chart: '#10B981',
  },
  medium: {
    label: 'Medium',
    range: '0.40 - 0.69',
    action: 'Monitor',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
    chart: '#F59E0B',
  },
  high: {
    label: 'High',
    range: '0.70 - 0.89',
    action: 'Flag',
    badge: 'bg-brand-50 text-brand-700 border-brand-200',
    dot: 'bg-brand-500',
    bar: 'bg-brand-500',
    chart: '#E8582A',
  },
  critical: {
    label: 'Critical',
    range: '0.90 - 1.00',
    action: 'Alert and investigate',
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    dot: 'bg-rose-600',
    bar: 'bg-rose-600',
    chart: '#E11D48',
  },
};

export const RISK_ORDER = ['low', 'medium', 'high', 'critical'];

export function riskMeta(level) {
  return RISK_LEVELS[level] || RISK_LEVELS.low;
}

export function isFlagged(level) {
  return level === 'high' || level === 'critical';
}

export const ALERT_TYPE_LABELS = {
  critical_fraud_probability: 'Critical fraud probability',
  high_fraud_probability: 'High fraud probability',
  transaction_velocity: 'Transaction velocity',
  high_value_anomaly: 'High value anomaly',
  amount_deviation: 'Amount deviation',
  geographical_anomaly: 'Geographical anomaly',
};

export function alertTypeLabel(type) {
  return (
    ALERT_TYPE_LABELS[type] ||
    String(type || 'unknown')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase())
  );
}

export const ALERT_STATUSES = ['open', 'investigating', 'resolved', 'dismissed'];

export const ALERT_STATUS_STYLES = {
  open: 'bg-rose-50 text-rose-700 border-rose-200',
  investigating: 'bg-amber-50 text-amber-800 border-amber-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  dismissed: 'bg-slate-100 text-ink-600 border-slate-200',
};

/** Latency colour coding against the 50 ms budget. */
export function latencyTone(ms, target = 50) {
  if (ms === null || ms === undefined) return 'text-ink-500';
  if (ms < target * 0.4) return 'text-emerald-600';
  if (ms < target) return 'text-amber-600';
  return 'text-rose-600';
}
