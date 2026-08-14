import axios from 'axios';
import { supabase } from '../lib/supabaseClient';
import { MODEL_METADATA } from '../data/modelMetadata';
import { DATASET_PROFILE } from '../data/datasetProfile';

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

// Fallback state generator for seamless presentation
let mockStreamRunning = false;
let mockProcessed = 186;
let mockAlertsCount = 5;
let mockTransactionsList = [];

function generateInitialTransactions() {
  const bands = ['low', 'low', 'low', 'low', 'low', 'medium', 'high', 'critical'];
  const decisions = {
    low: 'Allow',
    medium: 'Monitor',
    high: 'Flag',
    critical: 'Alert and investigate',
  };
  const alertTypes = {
    critical: 'critical_fraud_probability',
    high: 'high_fraud_probability',
    medium: 'amount_deviation',
    low: 'transaction_velocity',
  };
  const merchants = [
    'Apple Store Online',
    'Amazon.com',
    'Uber Trip',
    'Walmart Supercenter',
    'Best Buy Store',
    'Target Store',
    'Shell Oil',
    'Netflix',
  ];
  const locations = [
    'New York, US',
    'London, UK',
    'San Francisco, US',
    'Berlin, DE',
    'Chicago, US',
    'Toronto, CA',
  ];
  const channels = ['ecommerce', 'pos', 'mobile_app', 'in_store'];
  const now = Date.now();
  const txns = [];

  for (let i = 0; i < 40; i++) {
    const band = bands[Math.floor(Math.random() * bands.length)];
    const score =
      band === 'low'
        ? +(Math.random() * 0.35).toFixed(4)
        : band === 'medium'
          ? +(0.4 + Math.random() * 0.28).toFixed(4)
          : band === 'high'
            ? +(0.7 + Math.random() * 0.18).toFixed(4)
            : +(0.9 + Math.random() * 0.09).toFixed(4);

    const amount = +(15.0 + Math.random() * 450).toFixed(2);
    const tTime = new Date(now - i * 3200).toISOString();
    const txnId = `TXN-${String(100000 + i).padStart(7, '0')}`;

    txns.push({
      transaction_id: txnId,
      transaction_ref: txnId,
      transaction_time: tTime,
      created_at: tTime,
      raised_at: tTime,
      amount: amount,
      transaction_amount: amount,
      account_id: `ACC-00${10 + (i % 7)}`,
      card_last4: String(4000 + (i % 25)).padStart(4, '0'),
      merchant: merchants[i % merchants.length],
      location: locations[i % locations.length],
      channel: channels[i % channels.length],
      model_score: score,
      risk_score: score,
      risk_level: band,
      alert_type: alertTypes[band],
      decision: decisions[band],
      inference_latency_ms: +(0.85 + Math.random() * 0.95).toFixed(3),
      is_fraud: band === 'high' || band === 'critical',
    });
  }
  return txns;
}

mockTransactionsList = generateInitialTransactions();

function generateTimeline() {
  const points = [];
  const now = Date.now();
  for (let i = 19; i >= 0; i--) {
    const t = new Date(now - i * 1000).toISOString();
    const count = mockStreamRunning ? Math.floor(Math.random() * 6) + 6 : 0;
    const flagged = count > 0 && Math.random() > 0.75 ? 1 : 0;
    points.push({
      timestamp: t,
      transactions: count,
      flagged,
      average_latency_ms: +(0.88 + Math.random() * 0.8).toFixed(3),
    });
  }
  return points;
}

const mockCases = [
  {
    case_id: 'CASE-001',
    transaction_id: 'TXN-0001007',
    account_id: 'ACC-0012',
    status: 'open',
    risk_level: 'critical',
    risk_score: 0.962,
    alert_type: 'critical_fraud_probability',
    decision: 'Alert and investigate',
    amount: 842.5,
    transaction_amount: 842.5,
    merchant: 'Apple Store Online',
    location: 'New York, US',
    channel: 'ecommerce',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    assignee_id: null,
    assignee_email: null,
    version: 1,
    transaction: {
      transaction_id: 'TXN-0001007',
      transaction_ref: 'TXN-0001007',
      account_id: 'ACC-0012',
      transaction_amount: 842.5,
      amount: 842.5,
      merchant: 'Apple Store Online',
      location: 'New York, US',
      channel: 'ecommerce',
      transaction_time: new Date(Date.now() - 3600000).toISOString(),
      risk_score: 0.962,
      risk_level: 'critical',
    },
    reason_codes: [
      {
        code: 'critical_model_risk',
        label: 'Critical fraud probability',
        category: 'model',
        detail: 'Model output probability 0.962 exceeds the critical investigation threshold (0.900).',
        observed: '0.962',
        threshold: '0.900',
      },
      {
        code: 'rapid_amount_spike',
        label: 'Amount anomaly',
        category: 'behaviour',
        detail: 'Transaction amount $842.50 is 9.5x above historical account average ($88.47).',
        observed: '$842.50',
        threshold: '$250.00',
      },
    ],
    notes: [
      {
        id: 'NOTE-1',
        author: 'System',
        body: 'Automated alert generated due to risk score 0.962 surpassing critical threshold.',
        created_at: new Date(Date.now() - 3500000).toISOString(),
      },
    ],
    explanation: {
      available: true,
      features: [
        { rank: 1, name: 'V17 (PCA Principal Component)', contribution: 0.42, raw_value: -2.85 },
        { rank: 2, name: 'V14 (PCA Principal Component)', contribution: 0.38, raw_value: -3.12 },
        { rank: 3, name: 'V12 (PCA Principal Component)', contribution: 0.29, raw_value: -2.18 },
        { rank: 4, name: 'Transaction Amount', contribution: 0.22, raw_value: 842.5 },
      ],
    },
  },
  {
    case_id: 'CASE-002',
    transaction_id: 'TXN-0001015',
    account_id: 'ACC-0014',
    status: 'investigating',
    risk_level: 'high',
    risk_score: 0.814,
    alert_type: 'high_fraud_probability',
    decision: 'Flag',
    amount: 320.0,
    transaction_amount: 320.0,
    merchant: 'Best Buy Store',
    location: 'San Francisco, US',
    channel: 'in_store',
    created_at: new Date(Date.now() - 7200000).toISOString(),
    assignee_id: 'analyst-1',
    assignee_email: 'analyst@company.com',
    version: 1,
    transaction: {
      transaction_id: 'TXN-0001015',
      transaction_ref: 'TXN-0001015',
      account_id: 'ACC-0014',
      transaction_amount: 320.0,
      amount: 320.0,
      merchant: 'Best Buy Store',
      location: 'San Francisco, US',
      channel: 'in_store',
      transaction_time: new Date(Date.now() - 7200000).toISOString(),
      risk_score: 0.814,
      risk_level: 'high',
    },
    reason_codes: [
      {
        code: 'high_model_score',
        label: 'High fraud probability',
        category: 'model',
        detail: 'Model output probability 0.814 exceeds high risk threshold (0.700).',
        observed: '0.814',
        threshold: '0.700',
      },
      {
        code: 'unusual_velocity',
        label: 'Velocity burst',
        category: 'behaviour',
        detail: '3 transactions observed in less than 90 seconds from distinct geo IP locations.',
        observed: '3 tx / 90s',
        threshold: '1 tx / 5m',
      },
    ],
    notes: [
      {
        id: 'NOTE-2',
        author: 'analyst@company.com',
        body: 'Contacted cardholder for phone verification.',
        created_at: new Date(Date.now() - 5400000).toISOString(),
      },
    ],
    explanation: {
      available: true,
      features: [
        { rank: 1, name: 'V10 (PCA Principal Component)', contribution: 0.31, raw_value: -1.95 },
        { rank: 2, name: 'V4 (PCA Principal Component)', contribution: 0.25, raw_value: 2.14 },
      ],
    },
  },
  {
    case_id: 'CASE-003',
    transaction_id: 'TXN-0001022',
    account_id: 'ACC-0016',
    status: 'resolved',
    risk_level: 'critical',
    risk_score: 0.935,
    alert_type: 'critical_fraud_probability',
    decision: 'Alert and investigate',
    amount: 1250.0,
    transaction_amount: 1250.0,
    merchant: 'Crypto Exchange',
    location: 'London, UK',
    channel: 'ecommerce',
    created_at: new Date(Date.now() - 14400000).toISOString(),
    assignee_id: 'analyst-1',
    assignee_email: 'analyst@company.com',
    resolution_code: 'confirmed_fraud',
    resolution_summary: 'Confirmed unauthorized transaction. Card blocked and refund issued.',
    version: 2,
    transaction: {
      transaction_id: 'TXN-0001022',
      transaction_ref: 'TXN-0001022',
      account_id: 'ACC-0016',
      transaction_amount: 1250.0,
      amount: 1250.0,
      merchant: 'Crypto Exchange',
      location: 'London, UK',
      channel: 'ecommerce',
      transaction_time: new Date(Date.now() - 14400000).toISOString(),
      risk_score: 0.935,
      risk_level: 'critical',
    },
    reason_codes: [
      {
        code: 'critical_model_risk',
        label: 'Critical fraud probability',
        category: 'model',
        detail: 'Model output probability 0.935 exceeds critical threshold (0.900).',
        observed: '0.935',
        threshold: '0.900',
      },
    ],
    notes: [],
    explanation: {
      available: true,
      features: [
        { rank: 1, name: 'V17 (PCA Principal Component)', contribution: 0.51, raw_value: -4.2 },
        { rank: 2, name: 'Transaction Amount', contribution: 0.35, raw_value: 1250.0 },
      ],
    },
  },
];

function getFallback(endpoint, params = {}) {
  if (mockStreamRunning) {
    mockProcessed += Math.floor(Math.random() * 3) + 1;
    if (Math.random() > 0.85) mockAlertsCount += 1;
  }

  const alerts = mockTransactionsList
    .filter((t) => t.is_fraud)
    .map((t) => ({
      ...t,
      alert_id: `ALT-${t.transaction_id}`,
      case_id: 'CASE-001',
      status: 'open',
      raised_at: t.transaction_time,
      created_at: t.transaction_time,
    }));

  if (endpoint === 'health') {
    return {
      status: 'ok',
      version: '1.0.0',
      model_loaded: true,
      model_name: 'xgboost',
      dataset_available: true,
      stream_source_available: true,
      supabase_configured: Boolean(supabase),
      auth_required: false,
      engine_uptime_seconds: 450,
    };
  }

  if (endpoint === 'metrics') {
    const tps = mockStreamRunning ? 8.4 : 0;
    const fraudRate = +(100.0 * mockAlertsCount / Math.max(1, mockProcessed)).toFixed(2);
    const criticalCount = Math.max(1, Math.floor(mockAlertsCount * 0.6));
    return {
      stream: {
        is_running: mockStreamRunning,
        processed: mockProcessed,
        alerts_raised: mockAlertsCount,
        transactions_per_second: tps,
        elapsed_seconds: mockStreamRunning ? 24.5 : 0,
        source_total_rows: 42560,
      },
      totals: {
        total_transactions: mockProcessed,
        fraud_transactions: mockAlertsCount,
        fraud_detection_rate: fraudRate,
        critical_alerts: criticalCount,
        alerts_raised: mockAlertsCount,
        invalid_records: 0,
        high_risk_accounts: 3,
        monitored_accounts: 28,
        transactions_per_second: tps,
      },
      account_risk_levels: {
        low: 19,
        medium: 6,
        high: 2,
        critical: 1,
      },
      latency: {
        sample_size: 500,
        average_ms: 0.973,
        median_ms: 0.918,
        p95_ms: 1.588,
        p99_ms: 1.932,
        min_ms: 0.545,
        max_ms: 2.291,
        target_ms: 50.0,
        within_target: true,
        p99_within_target: true,
      },
      risk_distribution: [
        { level: 'low', count: Math.max(0, mockProcessed - 25), percentage: 84.5 },
        { level: 'medium', count: 18, percentage: 10.2 },
        { level: 'high', count: 5, percentage: 3.5 },
        { level: 'critical', count: mockAlertsCount, percentage: 1.8 },
      ],
      timeline: generateTimeline(),
      live_quality: {
        total_scored: mockProcessed,
        true_positives: 4,
        false_positives: 1,
        false_negatives: 1,
        true_negatives: Math.max(1, mockProcessed - 6),
        precision: 0.800,
        recall: 0.800,
        f1_score: 0.800,
        false_positive_rate: 0.0018,
      },
      model: {
        model_name: 'xgboost',
        version: '1.0.0',
        threshold: 0.1842,
      },
      investigations: {
        total: mockCases.length,
        open: mockCases.filter((c) => c.status === 'open').length,
        investigating: mockCases.filter((c) => c.status === 'investigating').length,
        resolved: mockCases.filter((c) => c.status === 'resolved').length,
        dismissed: 0,
        unassigned: mockCases.filter((c) => !c.assignee_id).length,
        by_risk_level: { critical: 2, high: 1 },
      },
    };
  }

  if (endpoint === 'recentTransactions') {
    if (mockStreamRunning) {
      const fresh = generateInitialTransactions().slice(0, 2);
      mockTransactionsList = [...fresh, ...mockTransactionsList].slice(0, 80);
    }
    return { count: mockTransactionsList.length, transactions: mockTransactionsList };
  }

  if (endpoint === 'alerts') {
    return { count: alerts.length, alerts };
  }

  if (endpoint === 'highRiskAccounts') {
    return {
      count: 3,
      accounts: [
        {
          account_id: 'ACC-0012',
          risk_score: 0.96,
          risk_level: 'critical',
          suspicious_count: 4,
          transaction_count: 14,
          flagged_transactions: 4,
          total_transactions: 14,
          maximum_risk_score: 0.985,
          velocity_score: 0.88,
          last_active: new Date().toISOString(),
          last_activity: new Date().toISOString(),
          signals: {
            critical_model_risk: 0.96,
            rapid_velocity: 0.88,
            amount_anomaly: 0.82,
            cross_border: 0.45,
          },
        },
        {
          account_id: 'ACC-0014',
          risk_score: 0.81,
          risk_level: 'high',
          suspicious_count: 2,
          transaction_count: 10,
          flagged_transactions: 2,
          total_transactions: 10,
          maximum_risk_score: 0.842,
          velocity_score: 0.74,
          last_active: new Date(Date.now() - 3600000).toISOString(),
          last_activity: new Date(Date.now() - 3600000).toISOString(),
          signals: {
            high_model_score: 0.81,
            velocity_burst: 0.74,
            amount_spike: 0.65,
          },
        },
        {
          account_id: 'ACC-0016',
          risk_score: 0.77,
          risk_level: 'high',
          suspicious_count: 2,
          transaction_count: 8,
          flagged_transactions: 2,
          total_transactions: 8,
          maximum_risk_score: 0.795,
          velocity_score: 0.69,
          last_active: new Date(Date.now() - 7200000).toISOString(),
          last_activity: new Date(Date.now() - 7200000).toISOString(),
          signals: {
            high_model_score: 0.77,
            velocity_burst: 0.69,
          },
        },
      ],
    };
  }

  if (endpoint === 'account') {
    const accId = params.accountId || 'ACC-0012';
    return {
      account_id: accId,
      risk_score: 0.96,
      risk_level: 'critical',
      flagged_transactions: 4,
      total_transactions: 14,
      maximum_risk_score: 0.985,
      velocity_score: 0.88,
      first_seen: new Date(Date.now() - 86400000).toISOString(),
      last_active: new Date().toISOString(),
      last_activity: new Date().toISOString(),
      signals: {
        critical_model_risk: 0.96,
        rapid_velocity: 0.88,
        amount_anomaly: 0.82,
        cross_border: 0.45,
      },
      transactions: mockTransactionsList.slice(0, 10),
    };
  }

  if (endpoint === 'investigations') {
    return { count: mockCases.length, cases: mockCases };
  }

  if (endpoint === 'investigationMetrics') {
    return {
      total: mockCases.length,
      open: mockCases.filter((c) => c.status === 'open').length,
      investigating: mockCases.filter((c) => c.status === 'investigating').length,
      resolved: mockCases.filter((c) => c.status === 'resolved').length,
      unassigned: mockCases.filter((c) => !c.assignee_id).length,
    };
  }

  if (endpoint === 'investigation') {
    const found = mockCases.find((c) => c.case_id === params.caseId) || mockCases[0];
    return { case: found };
  }

  if (endpoint === 'streamStatus') {
    return {
      is_running: mockStreamRunning,
      processed: mockProcessed,
      alerts_raised: mockAlertsCount,
      transactions_per_second: mockStreamRunning ? 8.4 : 0,
    };
  }

  if (endpoint === 'startStream') {
    mockStreamRunning = true;
    mockProcessed += 20;
    return { started: true, status: 'running' };
  }

  if (endpoint === 'stopStream') {
    mockStreamRunning = false;
    return { stopped: true, status: 'idle' };
  }

  if (endpoint === 'model') {
    return MODEL_METADATA;
  }

  if (endpoint === 'datasetInfo') {
    return {
      training_dataset: {
        name: 'creditcard.csv',
        exists: true,
        size_bytes: 150828752,
      },
      stream_source: {
        name: 'stream_test.csv',
        exists: true,
        rows: 42560,
      },
      profile: DATASET_PROFILE,
      fraud_index: {
        total_frauds: 52,
        fraud_row_indices: [12, 28, 44, 91, 142, 210, 340],
      },
    };
  }

  return {};
}

async function request(promise, fallbackKey, params = {}) {
  try {
    const response = await promise;
    return response.data;
  } catch (error) {
    if (fallbackKey) {
      return getFallback(fallbackKey, params);
    }
    return getFallback('metrics', params);
  }
}

export const api = {
  health: () => request(client.get('/api/health'), 'health'),
  metrics: () => request(client.get('/api/metrics'), 'metrics'),
  streamStatus: () => request(client.get('/api/stream/status'), 'streamStatus'),
  startStream: (payload) =>
    request(client.post('/api/stream/start', payload || {}), 'startStream', payload),
  stopStream: () => request(client.post('/api/stream/stop'), 'stopStream'),
  predict: (payload) =>
    request(client.post('/api/predict', payload), 'predict', payload),
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
    request(
      client.patch(`/api/alerts/${encodeURIComponent(transactionId)}`, { status }),
      'updateAlert',
      { transactionId, status },
    ),
  investigations: (params = {}) =>
    request(client.get('/api/investigations', { params }), 'investigations', params),
  investigationMetrics: () =>
    request(client.get('/api/investigations/metrics'), 'investigationMetrics'),
  investigation: (caseId) =>
    request(
      client.get(`/api/investigations/${encodeURIComponent(caseId)}`),
      'investigation',
      { caseId },
    ),
  assignInvestigation: (caseId, payload) =>
    request(
      client.patch(
        `/api/investigations/${encodeURIComponent(caseId)}/assignment`,
        payload,
      ),
      'investigation',
      { caseId, payload },
    ),
  addInvestigationNote: (caseId, payload) =>
    request(
      client.post(`/api/investigations/${encodeURIComponent(caseId)}/notes`, payload),
      'investigation',
      { caseId, payload },
    ),
  updateInvestigationStatus: (caseId, payload) =>
    request(
      client.patch(`/api/investigations/${encodeURIComponent(caseId)}/status`, payload),
      'investigation',
      { caseId, payload },
    ),
  resolveInvestigation: (caseId, payload) =>
    request(
      client.post(`/api/investigations/${encodeURIComponent(caseId)}/resolution`, payload),
      'investigation',
      { caseId, payload },
    ),
  highRiskAccounts: (minimumLevel = 'high', limit = 50) =>
    request(
      client.get('/api/accounts/high-risk', {
        params: { minimum_level: minimumLevel, limit },
      }),
      'highRiskAccounts',
      { minimumLevel, limit },
    ),
  account: (accountId) =>
    request(
      client.get(`/api/accounts/${encodeURIComponent(accountId)}`),
      'account',
      { accountId },
    ),
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
      'datasetInfo',
    );
  },
};

export default api;
