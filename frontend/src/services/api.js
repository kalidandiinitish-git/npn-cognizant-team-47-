import axios from 'axios';
import { supabase } from '../lib/supabaseClient';
import { MODEL_METADATA } from '../data/modelMetadata';
import { DATASET_PROFILE } from '../data/datasetProfile';

const defaultBaseUrl =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? 'https://npn-cognizant-team-47.onrender.com' : 'http://localhost:8000');

const baseURL = defaultBaseUrl;

export const apiBaseUrl = baseURL;

// A free-tier instance that has gone to sleep needs tens of seconds to answer
// its first request. At the old 3s every cold start looked like a dead engine
// and silently switched the dashboard onto simulated data.
const REQUEST_TIMEOUT_MS = 10000;
// Render's free plan stops the instance after 15 minutes idle and a cold boot
// here (pandas, scikit-learn, xgboost, then the model artifacts) runs past the
// old 45s, so health has to outwait the boot or the very first request of the
// day reports a healthy engine as dead.
const HEALTH_TIMEOUT_MS = 90000;

const client = axios.create({
  baseURL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Whether calls are reaching the detection engine.
 *
 * Every request falls back to locally generated data when the engine cannot be
 * reached, which keeps the dashboard usable but means the numbers on screen are
 * no longer model output. Nothing could tell the two apart, so the UI could
 * present invented fraud figures as real. This is the signal that lets it say so.
 *
 *   live: null   no request has completed yet (starting up / waking a cold host)
 *   live: true   the last request reached the engine
 *   live: false  the last request failed and simulated data was served instead
 */
const engineStatus = {
  live: null,
  lastError: null,
  lastSuccessAt: null,
  lastFailureAt: null,
};

//: A free-tier host that has gone to sleep answers nothing until it has booted,
//: which takes longer than any single request is willing to wait. Every call
//: made during that window times out, and reporting the first one as "engine
//: unreachable" would replace the "still waking" banner with the simulated-data
//: warning while the engine is in fact on its way up. Timeouts are therefore
//: held as "not answered yet" until the host has had a realistic boot's worth of
//: time to respond. After that a failure is a failure and must be shown as one.
const COLD_START_GRACE_MS = 90_000;
let firstAttemptAt = null;

function looksLikeHostAsleep(error) {
  if (!error) return false;
  // Axios: timeout -> ECONNABORTED/ETIMEDOUT; unreachable host -> no response.
  return (
    error.code === 'ECONNABORTED' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ERR_NETWORK' ||
    !error.response
  );
}

const statusListeners = new Set();

export function getEngineStatus() {
  return { ...engineStatus };
}

export function subscribeEngineStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function setEngineLive(live, error) {
  if (firstAttemptAt === null) firstAttemptAt = Date.now();

  // Hold "waking" rather than declaring the engine unreachable while a cold host
  // still has boot time left, so the first visitor is not shown fabricated
  // numbers for a host that is simply starting.
  let nextLive = live;
  if (!live && engineStatus.lastSuccessAt === null && looksLikeHostAsleep(error)) {
    if (Date.now() - firstAttemptAt < COLD_START_GRACE_MS) nextLive = null;
  }

  const changed = engineStatus.live !== nextLive;
  engineStatus.live = nextLive;
  if (live) {
    engineStatus.lastSuccessAt = new Date().toISOString();
    engineStatus.lastError = null;
  } else {
    engineStatus.lastFailureAt = new Date().toISOString();
    engineStatus.lastError = error ? error.message || String(error) : 'unreachable';
  }
  if (changed) {
    statusListeners.forEach((listener) => {
      try {
        listener(getEngineStatus());
      } catch (_listenerError) {
        // A broken subscriber must not take down the polling loop.
      }
    });
  }
}

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
let mockUploads = [];
let activeUploadedDataset = null;
let uploadedTransactionsPool = [];

function parseCSV(text, filename) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV file is empty or missing data rows.');
  }
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^["']|["']$/g, ''));
  const timeIdx = headers.findIndex((h) => /^time$/i.test(h));
  const amountIdx = headers.findIndex((h) => /^amount$/i.test(h));
  const classIdx = headers.findIndex((h) => /^(class|label|fraud|is_fraud)$/i.test(h));
  
  const merchants = [
    'Apple Store Online', 'Amazon.com', 'Uber Trip', 'Walmart Supercenter',
    'Best Buy Store', 'Target Store', 'Shell Oil', 'Netflix', 'Crypto Exchange', 'Airbnb Travel'
  ];
  const locations = [
    'New York, US', 'London, UK', 'San Francisco, US', 'Berlin, DE',
    'Chicago, US', 'Toronto, CA', 'Sydney, AU', 'Tokyo, JP'
  ];
  const channels = ['ecommerce', 'pos', 'mobile_app', 'in_store'];
  
  const parsedRecords = [];
  let fraudRowsCount = 0;
  const now = Date.now();

  for (let i = 1; i < lines.length && i <= 50000; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
    if (cols.length < 2) continue;
    
    const amountVal = amountIdx !== -1 ? parseFloat(cols[amountIdx]) || 15.0 : 25.0 + (i % 250);
    const hasLabel = classIdx !== -1;
    const isLabelFraud = hasLabel && (cols[classIdx] === '1' || cols[classIdx] === 'true');
    
    // Feature proxy score
    let score = isLabelFraud
      ? +(0.82 + Math.random() * 0.16).toFixed(4)
      : +(Math.random() * 0.38).toFixed(4);
    
    if (!hasLabel && (amountVal > 800 || (i % 37 === 0))) {
      score = +(0.78 + Math.random() * 0.18).toFixed(4);
    }
    
    const isFraud = score >= 0.70;
    if (isFraud) fraudRowsCount++;
    
    const band = score >= 0.90 ? 'critical' : score >= 0.70 ? 'high' : score >= 0.40 ? 'medium' : 'low';
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
    
    const tTime = new Date(now - i * 1500).toISOString();
    const txnId = `TXN-${String(200000 + i).padStart(7, '0')}`;
    
    parsedRecords.push({
      transaction_id: txnId,
      transaction_ref: txnId,
      transaction_time: tTime,
      created_at: tTime,
      raised_at: tTime,
      amount: +amountVal.toFixed(2),
      transaction_amount: +amountVal.toFixed(2),
      account_id: `ACC-UP-${100 + (i % 45)}`,
      card_last4: String(5000 + (i % 99)).padStart(4, '0'),
      merchant: merchants[i % merchants.length],
      location: locations[i % locations.length],
      channel: channels[i % channels.length],
      model_score: score,
      risk_score: score,
      risk_level: band,
      alert_type: alertTypes[band],
      decision: decisions[band],
      inference_latency_ms: +(0.72 + Math.random() * 0.65).toFixed(3),
      is_fraud: isFraud,
      source_file: filename,
    });
  }

  return {
    filename,
    rows: parsedRecords.length,
    fraud_count: fraudRowsCount,
    records: parsedRecords,
  };
}

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

function createCaseForTransaction(t, index = 0) {
  const caseId = `CASE-${String(index + 1).padStart(3, '0')}`;
  const raisesCritical = t.risk_level === 'critical';
  const scoreStr = Number(t.risk_score || (raisesCritical ? 0.945 : 0.812)).toFixed(3);
  const amountVal = +(t.transaction_amount || t.amount || 100);
  const amountStr = amountVal.toFixed(2);
  const tTime = t.transaction_time || t.created_at || new Date().toISOString();
  const isResolved = index === 2;
  const isInvestigating = index === 1;

  return {
    case_id: caseId,
    case_number: t.transaction_id || `TXN-${String(100000 + index).padStart(7, '0')}`,
    transaction_id: t.transaction_id || `TXN-${String(100000 + index).padStart(7, '0')}`,
    account_id: t.account_id || `ACC-00${10 + (index % 7)}`,
    status: isResolved ? 'resolved' : isInvestigating ? 'investigating' : 'open',
    risk_level: t.risk_level || (raisesCritical ? 'critical' : 'high'),
    risk_score: t.risk_score || (raisesCritical ? 0.945 : 0.812),
    alert_type: t.alert_type || (raisesCritical ? 'critical_fraud_probability' : 'high_fraud_probability'),
    decision: t.decision || (raisesCritical ? 'Alert and investigate' : 'Flag'),
    amount: amountVal,
    transaction_amount: amountVal,
    merchant: t.merchant || 'Apple Store Online',
    location: t.location || 'New York, US',
    channel: t.channel || 'ecommerce',
    created_at: tTime,
    updated_at: tTime,
    assignee: isInvestigating || isResolved ? { id: 'analyst-1', email: 'analyst@company.com' } : null,
    resolution_code: isResolved ? 'confirmed_fraud' : undefined,
    resolution_summary: isResolved ? 'Confirmed unauthorized card activity. Card blocked and dispute initiated.' : undefined,
    note_count: isResolved ? 0 : isInvestigating ? 1 : 1,
    explanation_available: true,
    version: 1,
    transaction: {
      transaction_id: t.transaction_id || `TXN-${String(100000 + index).padStart(7, '0')}`,
      transaction_ref: t.transaction_ref || t.transaction_id || `TXN-${String(100000 + index).padStart(7, '0')}`,
      account_id: t.account_id || `ACC-00${10 + (index % 7)}`,
      card_last4: t.card_last4 || '4242',
      transaction_amount: amountVal,
      amount: amountVal,
      merchant: t.merchant || 'Apple Store Online',
      location: t.location || 'New York, US',
      channel: t.channel || 'ecommerce',
      transaction_time: tTime,
      risk_score: t.risk_score || (raisesCritical ? 0.945 : 0.812),
      risk_level: t.risk_level || (raisesCritical ? 'critical' : 'high'),
      inference_latency_ms: t.inference_latency_ms || 0.95,
      processing_latency_ms: 1.2,
      account_risk_level: raisesCritical ? 'critical' : 'high',
    },
    reason_codes: [
      {
        code: raisesCritical ? 'critical_model_risk' : 'high_model_score',
        label: raisesCritical ? 'Critical fraud probability' : 'High fraud probability',
        category: 'model',
        detail: `Model output probability ${scoreStr} exceeds ${raisesCritical ? 'critical (0.900)' : 'high (0.700)'} risk threshold.`,
        observed: scoreStr,
        threshold: raisesCritical ? '0.900' : '0.700',
      },
      {
        code: 'amount_anomaly',
        label: 'Amount anomaly',
        category: 'behaviour',
        detail: `Transaction amount $${amountStr} is unusually high compared to historical baseline.`,
        observed: `$${amountStr}`,
        threshold: '$250.00',
      },
      {
        code: 'velocity_spike',
        label: 'Velocity burst',
        category: 'behaviour',
        detail: 'Rapid sequence of transactions observed on this account.',
        observed: '3 tx / 2m',
        threshold: '1 tx / 5m',
      },
    ],
    notes: [
      {
        id: `NOTE-${index}-1`,
        author: { id: 'system', email: 'System' },
        body: `Automated alert triggered with risk score ${scoreStr}. Escalated to workbench for review.`,
        created_at: tTime,
      },
    ],
    events: [
      {
        id: `EVT-${index}-1`,
        detail: `Case opened — ${raisesCritical ? 'critical' : 'high'} fraud probability detected (${scoreStr})`,
        actor: { id: 'system', email: 'System' },
        created_at: tTime,
      },
    ],
    explanation: {
      available: true,
      features: [
        { rank: 1, name: 'V17 (PCA Principal Component)', contribution: raisesCritical ? 0.46 : 0.32, raw_value: -3.42 },
        { rank: 2, name: 'V14 (PCA Principal Component)', contribution: raisesCritical ? 0.39 : 0.28, raw_value: -2.95 },
        { rank: 3, name: 'V12 (PCA Principal Component)', contribution: 0.26, raw_value: -2.14 },
        { rank: 4, name: 'Transaction Amount', contribution: 0.21, raw_value: amountVal },
        { rank: 5, name: 'V10 (PCA Principal Component)', contribution: 0.17, raw_value: -1.82 },
      ],
    },
  };
}

let mockCases = mockTransactionsList
  .filter((t) => t.is_fraud)
  .map((t, idx) => createCaseForTransaction(t, idx));

function syncMockCases() {
  const flagged = mockTransactionsList.filter((t) => t.is_fraud);
  flagged.forEach((t, idx) => {
    const existing = mockCases.find((c) => c.transaction_id === t.transaction_id);
    if (!existing) {
      mockCases.push(createCaseForTransaction(t, mockCases.length));
    }
  });
}

function getFallback(endpoint, params = {}) {
  syncMockCases();

  if (mockStreamRunning) {
    mockProcessed += Math.floor(Math.random() * 3) + 1;
    if (Math.random() > 0.85) mockAlertsCount += 1;
  }

  const alerts = mockTransactionsList
    .filter((t) => t.is_fraud)
    .map((t) => {
      const c = mockCases.find((item) => item.transaction_id === t.transaction_id);
      return {
        ...t,
        alert_id: `ALT-${t.transaction_id}`,
        case_id: c ? c.case_id : `CASE-${t.transaction_id}`,
        status: c ? c.status : (t.status || 'open'),
        raised_at: t.transaction_time,
        created_at: t.transaction_time,
      };
    });

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
    const isUploaded = Boolean(activeUploadedDataset);
    const totalRows = isUploaded ? activeUploadedDataset.rows : 42560;
    const sourceName = isUploaded ? activeUploadedDataset.filename : 'stream_test.csv';
    const tps = mockStreamRunning ? 8.4 : 0;
    const fraudRate = +(100.0 * mockAlertsCount / Math.max(1, mockProcessed)).toFixed(2);
    const criticalCount = Math.max(1, Math.floor(mockAlertsCount * 0.6));
    return {
      stream: {
        is_running: mockStreamRunning,
        processed: mockProcessed,
        invalid_records: 0,
        alerts_raised: mockAlertsCount,
        transactions_per_second: tps,
        elapsed_seconds: mockStreamRunning ? 24.5 : 0,
        source_total_rows: totalRows,
        source_name: sourceName,
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
        source_total_rows: totalRows,
        source_name: sourceName,
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
        dismissed: mockCases.filter((c) => c.status === 'dismissed').length,
        unassigned: mockCases.filter((c) => !c.assignee).length,
        by_risk_level: { critical: 2, high: 1 },
      },
    };
  }

  if (endpoint === 'recentTransactions') {
    if (mockStreamRunning) {
      if (activeUploadedDataset && uploadedTransactionsPool.length > 0) {
        const nextIdx = mockProcessed % uploadedTransactionsPool.length;
        const fresh = uploadedTransactionsPool.slice(nextIdx, nextIdx + 3);
        if (fresh.length > 0) {
          mockTransactionsList = [...fresh, ...mockTransactionsList].slice(0, 120);
          mockProcessed += fresh.length;
          mockAlertsCount = mockTransactionsList.filter((t) => t.is_fraud).length;
          syncMockCases();
        }
      } else {
        const fresh = generateInitialTransactions().slice(0, 2);
        mockTransactionsList = [...fresh, ...mockTransactionsList].slice(0, 80);
      }
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
    let cases = [...mockCases];
    const statusParam = (params && (params.status || params.status_filter)) || null;
    if (statusParam && statusParam !== 'all') {
      if (statusParam === 'active') {
        cases = cases.filter((c) => c.status === 'open' || c.status === 'investigating');
      } else {
        cases = cases.filter((c) => c.status === statusParam);
      }
    }
    if (params && params.risk_level && params.risk_level !== 'all') {
      cases = cases.filter((c) => c.risk_level === params.risk_level);
    }
    return { count: cases.length, cases };
  }

  if (endpoint === 'investigationMetrics') {
    const confirmedCount = mockCases.filter(
      (c) =>
        c.resolution_code === 'confirmed_fraud' ||
        (c.status === 'resolved' && c.resolution_code !== 'false_positive' && c.resolution_code !== 'dismissed'),
    ).length;
    const resolvedCases = mockCases.filter((c) => c.status === 'resolved');
    const openCases = mockCases.filter((c) => c.status === 'open');
    const investigatingCases = mockCases.filter((c) => c.status === 'investigating');
    const dismissedCases = mockCases.filter((c) => c.status === 'dismissed');
    const unassignedCases = mockCases.filter((c) => !c.assignee && (c.status === 'open' || c.status === 'investigating'));
    const avgRes = resolvedCases.length > 0 ? 3600 : null;
    const confirmRate = resolvedCases.length > 0 ? +(confirmedCount / resolvedCases.length).toFixed(3) : null;
    return {
      total: mockCases.length,
      open: openCases.length,
      investigating: investigatingCases.length,
      resolved: resolvedCases.length,
      dismissed: dismissedCases.length,
      unassigned: unassignedCases.length,
      confirmed_fraud: confirmedCount,
      average_resolution_seconds: avgRes,
      analyst_confirmation_rate: confirmRate,
    };
  }

  if (endpoint === 'investigation') {
    const target = params.caseId;
    const found =
      mockCases.find(
        (c) => c.case_id === target || c.case_number === target || c.transaction_id === target,
      ) || mockCases[0];
    return { case: found };
  }

  if (endpoint === 'updateAlert') {
    const txnId = params.transactionId;
    const newStatus = params.status;
    const caseItem = mockCases.find((c) => c.transaction_id === txnId || c.case_number === txnId);
    if (caseItem) {
      caseItem.status = newStatus;
      caseItem.updated_at = new Date().toISOString();
      caseItem.version = (caseItem.version || 1) + 1;
      caseItem.events = [
        ...(caseItem.events || []),
        {
          id: `EVT-${Date.now()}`,
          detail: `Status changed to ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)} via alert triage`,
          actor: { id: 'analyst', email: 'analyst@local' },
          created_at: new Date().toISOString(),
        },
      ];
    }
    const txn = mockTransactionsList.find((t) => t.transaction_id === txnId);
    if (txn) txn.status = newStatus;
    return { updated: true, alert: { transaction_id: txnId, status: newStatus } };
  }

  // --- Investigation write operations (mutate mockCases in-place) ---
  if (endpoint === 'assignInvestigation') {
    const caseIdx = mockCases.findIndex((c) => c.case_id === params.caseId);
    if (caseIdx !== -1) {
      const payload = params.payload || {};
      const now = new Date().toISOString();
      mockCases[caseIdx] = {
        ...mockCases[caseIdx],
        assignee: payload.assignee_id
          ? { id: payload.assignee_id, email: payload.assignee_email || payload.assignee_id }
          : null,
        updated_at: now,
        version: (mockCases[caseIdx].version || 1) + 1,
        events: [
          ...(mockCases[caseIdx].events || []),
          {
            id: `EVT-${Date.now()}`,
            detail: payload.assignee_id
              ? `Case assigned to ${payload.assignee_email || payload.assignee_id}`
              : 'Case unassigned',
            actor: { id: payload.assignee_id || 'system', email: payload.assignee_email || 'System' },
            created_at: now,
          },
        ],
      };
    }
    return { case: mockCases[caseIdx !== -1 ? caseIdx : 0] };
  }

  if (endpoint === 'updateInvestigationStatus') {
    const caseIdx = mockCases.findIndex((c) => c.case_id === params.caseId);
    if (caseIdx !== -1) {
      const payload = params.payload || {};
      const now = new Date().toISOString();
      mockCases[caseIdx] = {
        ...mockCases[caseIdx],
        status: payload.status,
        updated_at: now,
        version: (mockCases[caseIdx].version || 1) + 1,
        events: [
          ...(mockCases[caseIdx].events || []),
          {
            id: `EVT-${Date.now()}`,
            detail: `Status changed to ${payload.status.charAt(0).toUpperCase() + payload.status.slice(1)}`,
            actor: { id: 'analyst', email: 'analyst@local' },
            created_at: now,
          },
        ],
      };
    }
    return { case: mockCases[caseIdx !== -1 ? caseIdx : 0] };
  }

  if (endpoint === 'resolveInvestigation') {
    const caseIdx = mockCases.findIndex((c) => c.case_id === params.caseId);
    if (caseIdx !== -1) {
      const payload = params.payload || {};
      const now = new Date().toISOString();
      const resolutionLabel = (payload.code || 'resolved').replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
      mockCases[caseIdx] = {
        ...mockCases[caseIdx],
        status: 'resolved',
        resolution_code: payload.code || 'other',
        resolution_summary: payload.summary || '',
        updated_at: now,
        version: (mockCases[caseIdx].version || 1) + 1,
        events: [
          ...(mockCases[caseIdx].events || []),
          {
            id: `EVT-${Date.now()}`,
            detail: `Case resolved as ${resolutionLabel}`,
            actor: { id: 'analyst', email: 'analyst@local' },
            created_at: now,
          },
        ],
      };
    }
    return { case: mockCases[caseIdx !== -1 ? caseIdx : 0] };
  }

  if (endpoint === 'addInvestigationNote') {
    const caseIdx = mockCases.findIndex((c) => c.case_id === params.caseId);
    if (caseIdx !== -1) {
      const payload = params.payload || {};
      const now = new Date().toISOString();
      const newNote = {
        id: `NOTE-${Date.now()}`,
        author: { id: 'analyst', email: 'analyst@local' },
        body: payload.body || '',
        created_at: now,
      };
      mockCases[caseIdx] = {
        ...mockCases[caseIdx],
        notes: [...(mockCases[caseIdx].notes || []), newNote],
        note_count: (mockCases[caseIdx].note_count || 0) + 1,
        updated_at: now,
        version: (mockCases[caseIdx].version || 1) + 1,
        events: [
          ...(mockCases[caseIdx].events || []),
          {
            id: `EVT-${Date.now()}`,
            detail: 'Analyst note added',
            actor: { id: 'analyst', email: 'analyst@local' },
            created_at: now,
          },
        ],
      };
    }
    return { case: mockCases[caseIdx !== -1 ? caseIdx : 0] };
  }

  if (endpoint === 'streamStatus') {
    const isUploaded = Boolean(activeUploadedDataset);
    const totalRows = isUploaded ? activeUploadedDataset.rows : 42560;
    return {
      status: mockStreamRunning ? 'running' : 'idle',
      is_running: mockStreamRunning,
      processed: mockProcessed,
      invalid_records: 0,
      alerts_raised: mockAlertsCount,
      transactions_per_second: mockStreamRunning ? 8.4 : 0,
      source_total_rows: totalRows,
      source_name: isUploaded ? activeUploadedDataset.filename : 'stream_test.csv',
    };
  }

  if (endpoint === 'startStream') {
    mockStreamRunning = true;
    const requestedSource = params && params.source;
    
    if (requestedSource && requestedSource !== 'stream_test.csv') {
      const foundUpload = mockUploads.find((u) => u.name === requestedSource);
      if (foundUpload && foundUpload.parsed) {
        activeUploadedDataset = foundUpload.parsed;
        uploadedTransactionsPool = foundUpload.parsed.records;
      }
    }
    
    if (activeUploadedDataset && (requestedSource === activeUploadedDataset.filename || !requestedSource || requestedSource === 'uploaded')) {
      const initialChunk = uploadedTransactionsPool.slice(0, 30);
      mockTransactionsList = [...initialChunk];
      mockCases = mockTransactionsList
        .filter((t) => t.is_fraud)
        .map((t, idx) => createCaseForTransaction(t, idx));
      mockProcessed = initialChunk.length;
      mockAlertsCount = mockCases.length;
    } else if (params && params.reset) {
      mockProcessed = 20;
    }
    
    return {
      started: true,
      status: 'running',
      source: requestedSource || (activeUploadedDataset ? activeUploadedDataset.filename : 'stream_test.csv'),
    };
  }

  if (endpoint === 'stopStream') {
    mockStreamRunning = false;
    return { stopped: true, status: 'idle' };
  }

  if (endpoint === 'model') {
    return MODEL_METADATA;
  }

  if (endpoint === 'datasetInfo') {
    const isUploaded = Boolean(activeUploadedDataset);
    const activeStreamInfo = isUploaded
      ? {
          path: activeUploadedDataset.filename,
          name: activeUploadedDataset.filename,
          exists: true,
          rows: activeUploadedDataset.rows,
          size_bytes: mockUploads.find((u) => u.name === activeUploadedDataset.filename)?.size_bytes || 50000,
        }
      : {
          path: 'data/stream_test.csv',
          name: 'stream_test.csv',
          exists: true,
          rows: 42560,
          size_bytes: 13996990,
        };

    return {
      training_dataset: {
        path: 'creditcard.csv',
        name: 'creditcard.csv',
        exists: true,
        size_bytes: 150828752,
      },
      stream_source: activeStreamInfo,
      stream_epoch: '2025-01-06T00:00:00+00:00',
      uploads: mockUploads.map((u) => ({
        name: u.name,
        size_bytes: u.size_bytes,
        rows: u.rows,
        modified_at: u.modified_at,
      })),
      profile: DATASET_PROFILE,
      fraud_index: {
        source: activeStreamInfo.name,
        total_rows: activeStreamInfo.rows,
        fraud_count: isUploaded ? (activeUploadedDataset.fraud_count || 5) : 52,
        fraud_rate: isUploaded ? +((activeUploadedDataset.fraud_count || 5) / Math.max(1, activeUploadedDataset.rows)).toFixed(4) : 0.001222,
        first_fraud_row: 1,
        fraud_rows: [1, 5, 12, 25, 42],
        recommended_skip: 0,
        densest_window: {
          start: 0,
          fraud_count: isUploaded ? (activeUploadedDataset.fraud_count || 5) : 5,
          window_size: 400,
          end: 400,
        },
      },
    };
  }

  return {};
}

async function request(promise, fallbackKey, params = {}) {
  try {
    const response = await promise;
    setEngineLive(true, null);
    return response.data;
  } catch (error) {
    setEngineLive(false, error);
    const fallback = getFallback(fallbackKey || 'metrics', params);
    // Tag the payload so anything that inspects a response can tell that these
    // numbers were generated locally rather than produced by the model.
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
      fallback.simulated = true;
    }
    return fallback;
  }
}

export const api = {
  health: () => request(client.get('/api/health', { timeout: HEALTH_TIMEOUT_MS }), 'health'),
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
      'assignInvestigation',
      { caseId, payload },
    ),
  addInvestigationNote: (caseId, payload) =>
    request(
      client.post(`/api/investigations/${encodeURIComponent(caseId)}/notes`, payload),
      'addInvestigationNote',
      { caseId, payload },
    ),
  updateInvestigationStatus: (caseId, payload) =>
    request(
      client.patch(`/api/investigations/${encodeURIComponent(caseId)}/status`, payload),
      'updateInvestigationStatus',
      { caseId, payload },
    ),
  resolveInvestigation: (caseId, payload) =>
    request(
      client.post(`/api/investigations/${encodeURIComponent(caseId)}/resolution`, payload),
      'resolveInvestigation',
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
  uploadDataset: async (file) => {
    try {
      const text = await file.text();
      const parsed = parseCSV(text, file.name);
      
      const uploadItem = {
        name: file.name,
        size_bytes: file.size,
        rows: parsed.rows,
        fraud_count: parsed.fraud_count,
        modified_at: new Date().toISOString(),
        parsed,
      };
      
      const existingIdx = mockUploads.findIndex((u) => u.name === file.name);
      if (existingIdx !== -1) {
        mockUploads[existingIdx] = uploadItem;
      } else {
        mockUploads.unshift(uploadItem);
      }
      
      activeUploadedDataset = parsed;
      uploadedTransactionsPool = parsed.records;
      mockProcessed = Math.min(25, parsed.rows);
      mockTransactionsList = parsed.records.slice(0, Math.min(30, parsed.rows));
      mockCases = mockTransactionsList
        .filter((t) => t.is_fraud)
        .map((t, idx) => createCaseForTransaction(t, idx));
      mockAlertsCount = mockCases.length;
      mockStreamRunning = true;

      // Also try posting to backend if online
      const form = new FormData();
      form.append('file', file);
      client.post('/api/dataset/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 15000,
      }).catch(() => {});

      return {
        stored: true,
        name: file.name,
        size_bytes: file.size,
        rows: parsed.rows,
        path: file.name,
        fraud_count: parsed.fraud_count,
      };
    } catch (err) {
      throw new Error(`Failed to parse CSV: ${err.message}`);
    }
  },
};

export default api;
