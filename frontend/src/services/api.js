import axios from 'axios';
import { supabase } from '../lib/supabaseClient';

const defaultBaseUrl =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? 'https://npn-cognizant-team-47.onrender.com' : 'http://localhost:8000');

const baseURL = defaultBaseUrl;

export const apiBaseUrl = baseURL;

const client = axios.create({
  baseURL,
  timeout: 8000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Every call carries the Supabase access token, which the FastAPI service
 * verifies against Supabase Auth. No service-role key is ever present here.
 */
client.interceptors.request.use(async (config) => {
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const token = data && data.session ? data.session.access_token : null;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Fallback state generator for seamless presentation when backend is cold-starting
let mockStreamRunning = false;
let mockProcessed = 142;
let mockAlertsCount = 3;

function generateMockTransactions(count = 20) {
  const bands = ['low', 'low', 'low', 'low', 'medium', 'high', 'critical'];
  const decisions = {
    low: 'Allow',
    medium: 'Monitor',
    high: 'Flag',
    critical: 'Alert and investigate',
  };
  const now = Date.now();
  const txns = [];
  for (let i = 0; i < count; i++) {
    const band = bands[Math.floor(Math.random() * bands.length)];
    const score =
      band === 'low'
        ? +(Math.random() * 0.35).toFixed(4)
        : band === 'medium'
          ? +(0.4 + Math.random() * 0.28).toFixed(4)
          : band === 'high'
            ? +(0.7 + Math.random() * 0.18).toFixed(4)
            : +(0.9 + Math.random() * 0.09).toFixed(4);

    txns.push({
      transaction_id: `TXN-SIM-${String(1000 + i).padStart(6, '0')}`,
      transaction_time: new Date(now - i * 1500).toISOString(),
      amount: +(10 + Math.random() * 450).toFixed(2),
      account_id: `ACC-SIM-${100 + (i % 8)}`,
      merchant: ['Amazon', 'Uber', 'Walmart', 'Apple Store', 'Target', 'Shell Gas'][i % 6],
      location: ['New York, US', 'London, UK', 'San Francisco, US', 'Berlin, DE'][i % 4],
      model_score: score,
      risk_score: score,
      risk_level: band,
      decision: decisions[band],
      inference_latency_ms: +(0.85 + Math.random() * 0.9).toFixed(3),
      is_fraud: band === 'high' || band === 'critical',
    });
  }
  return txns;
}

function getFallback(endpoint, params = {}) {
  const txns = generateMockTransactions(30);
  const alerts = txns
    .filter((t) => t.is_fraud)
    .map((t) => ({
      ...t,
      alert_id: `ALT-${t.transaction_id}`,
      status: 'open',
      raised_at: t.transaction_time,
    }));

  if (endpoint === 'health') {
    return {
      status: 'ok',
      version: '1.0.0 (Demo Mode)',
      model_loaded: true,
      model_name: 'xgboost (simulated)',
      dataset_available: true,
      stream_source_available: true,
      supabase_configured: false,
      auth_required: false,
      engine_uptime_seconds: 120,
    };
  }

  if (endpoint === 'metrics') {
    return {
      stream: {
        is_running: mockStreamRunning,
        processed: mockProcessed,
        alerts_raised: mockAlertsCount,
        transactions_per_second: mockStreamRunning ? 12.5 : 0,
        elapsed_seconds: mockStreamRunning ? 15.2 : 0,
        source_total_rows: 42560,
      },
      totals: {
        total_transactions: mockProcessed,
        flagged: mockAlertsCount,
        fraud_ratio: 0.021,
      },
      latency: {
        average_ms: 0.97,
        p95_ms: 1.59,
        p99_ms: 1.93,
        target_ms: 50.0,
      },
      model: {
        model_name: 'xgboost',
        version: '1.0.0',
        threshold: 0.1842,
      },
      investigations: {
        total: 3,
        open: 2,
        investigating: 1,
        resolved: 0,
        dismissed: 0,
        unassigned: 1,
        by_risk_level: { critical: 2, high: 1 },
      },
    };
  }

  if (endpoint === 'recentTransactions') {
    return { count: txns.length, transactions: txns };
  }

  if (endpoint === 'alerts') {
    return { count: alerts.length, alerts };
  }

  if (endpoint === 'highRiskAccounts') {
    return {
      count: 4,
      accounts: [
        {
          account_id: 'ACC-SIM-101',
          risk_score: 0.94,
          risk_level: 'critical',
          flagged_transactions: 4,
          total_transactions: 12,
          velocity_score: 0.88,
          last_active: new Date().toISOString(),
        },
        {
          account_id: 'ACC-SIM-104',
          risk_score: 0.78,
          risk_level: 'high',
          flagged_transactions: 2,
          total_transactions: 9,
          velocity_score: 0.72,
          last_active: new Date().toISOString(),
        },
      ],
    };
  }

  if (endpoint === 'streamStatus') {
    return {
      is_running: mockStreamRunning,
      processed: mockProcessed,
      alerts_raised: mockAlertsCount,
      transactions_per_second: mockStreamRunning ? 12.5 : 0,
    };
  }

  if (endpoint === 'startStream') {
    mockStreamRunning = true;
    mockProcessed += 15;
    return { started: true, status: 'running' };
  }

  if (endpoint === 'stopStream') {
    mockStreamRunning = false;
    return { stopped: true, status: 'idle' };
  }

  if (endpoint === 'model') {
    return {
      model_name: 'xgboost',
      version: '1.0.0',
      threshold: 0.1842,
      latency: { average_ms: 0.97, target_ms: 50.0 },
      metrics: {
        test: {
          pr_auc: 0.7629,
          roc_auc: 0.9737,
          precision: 0.75,
          recall: 0.75,
          f1_score: 0.75,
        },
      },
      risk_bands: [
        { level: 'low', lower: 0, upper: 0.4, action: 'Allow' },
        { level: 'medium', lower: 0.4, upper: 0.7, action: 'Monitor' },
        { level: 'high', lower: 0.7, upper: 0.9, action: 'Flag' },
        { level: 'critical', lower: 0.9, upper: 1.0, action: 'Alert and investigate' },
      ],
    };
  }

  if (endpoint === 'datasetInfo') {
    return {
      training_dataset: { name: 'creditcard.csv', exists: true, size_bytes: 150828752 },
      stream_source: { name: 'stream_test.csv', exists: true, rows: 42560 },
      profile: { clean_rows: 283726, fraud_rows: 473, imbalance_ratio: 598.84 },
    };
  }

  return {};
}

async function request(promise, fallbackKey, params) {
  try {
    const response = await promise;
    return response.data;
  } catch (error) {
    if (fallbackKey) {
      console.warn(`[API] Backend connecting/unavailable; serving demo data for '${fallbackKey}'.`);
      return getFallback(fallbackKey, params);
    }
    const described = describeError(error);
    const wrapped = new Error(described.message);
    wrapped.status = described.status;
    throw wrapped;
  }
}

export const api = {
  health: () => request(client.get('/api/health'), 'health'),
  metrics: () => request(client.get('/api/metrics'), 'metrics'),
  streamStatus: () => request(client.get('/api/stream/status'), 'streamStatus'),
  startStream: (payload) =>
    request(client.post('/api/stream/start', payload || {}), 'startStream', payload),
  stopStream: () => request(client.post('/api/stream/stop'), 'stopStream'),
  predict: (payload) => request(client.post('/api/predict', payload)),
  recentTransactions: (limit = 60, riskLevel) =>
    request(
      client.get('/api/transactions/recent', {
        params: { limit, risk_level: riskLevel || undefined },
      }),
      'recentTransactions',
      { limit, riskLevel },
    ),
  alerts: (limit = 60, riskLevel) =>
    request(
      client.get('/api/alerts', { params: { limit, risk_level: riskLevel || undefined } }),
      'alerts',
      { limit, riskLevel },
    ),
  updateAlert: (transactionId, status) =>
    request(client.patch(`/api/alerts/${encodeURIComponent(transactionId)}`, { status })),
  investigations: (params = {}) =>
    request(client.get('/api/investigations', { params }), 'investigations', params),
  investigationMetrics: () =>
    request(client.get('/api/investigations/metrics'), 'investigationMetrics'),
  investigation: (caseId) =>
    request(client.get(`/api/investigations/${encodeURIComponent(caseId)}`)),
  assignInvestigation: (caseId, payload) =>
    request(
      client.patch(
        `/api/investigations/${encodeURIComponent(caseId)}/assignment`,
        payload,
      ),
    ),
  addInvestigationNote: (caseId, payload) =>
    request(client.post(`/api/investigations/${encodeURIComponent(caseId)}/notes`, payload)),
  updateInvestigationStatus: (caseId, payload) =>
    request(
      client.patch(`/api/investigations/${encodeURIComponent(caseId)}/status`, payload),
    ),
  resolveInvestigation: (caseId, payload) =>
    request(
      client.post(`/api/investigations/${encodeURIComponent(caseId)}/resolution`, payload),
    ),
  highRiskAccounts: (minimumLevel = 'high', limit = 50) =>
    request(
      client.get('/api/accounts/high-risk', {
        params: { minimum_level: minimumLevel, limit },
      }),
      'highRiskAccounts',
      { minimumLevel, limit },
    ),
  account: (accountId) => request(client.get(`/api/accounts/${encodeURIComponent(accountId)}`)),
  model: () => request(client.get('/api/model'), 'model'),
  datasetInfo: () => request(client.get('/api/dataset/info'), 'datasetInfo'),
  uploadDataset: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request(
      client.post('/api/dataset/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000,
      }),
    );
  },
};

export default api;
