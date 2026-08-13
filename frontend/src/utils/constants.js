import { RISK_ORDER } from './risk';

/** Filter options for the high-risk accounts table. */
export const ACCOUNT_LEVEL_OPTIONS = [
  { value: 'all', label: 'All levels' },
  ...RISK_ORDER.map((level) => ({
    value: level,
    label: level.charAt(0).toUpperCase() + level.slice(1),
  })),
];

/** Endpoints the API surface exposes, shown on the dataset page for reference. */
export const API_ENDPOINTS = [
  { method: 'GET', path: '/api/health', purpose: 'Engine readiness' },
  { method: 'POST', path: '/api/predict', purpose: 'Score one transaction' },
  { method: 'POST', path: '/api/stream/start', purpose: 'Start the pseudo-stream' },
  { method: 'POST', path: '/api/stream/stop', purpose: 'Stop the active stream' },
  { method: 'GET', path: '/api/stream/status', purpose: 'Current streaming state' },
  { method: 'GET', path: '/api/metrics', purpose: 'Dashboard metrics' },
  { method: 'GET', path: '/api/alerts', purpose: 'Recent fraud alerts' },
  { method: 'GET', path: '/api/accounts/high-risk', purpose: 'High-risk accounts' },
];

export const SUPPORTED_UPLOAD_TYPES = '.csv';
export const MAX_UPLOAD_MB = 250;
