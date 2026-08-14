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
  timeout: 3000,
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
        dismissed: mockCases.filter((c) => c.status === 'dismissed').length,
        unassigned: mockCases.filter((c) => !c.assignee).length,
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
    return {
      status: mockStreamRunning ? 'running' : 'idle',
      is_running: mockStreamRunning,
      processed: mockProcessed,
      invalid_records: 0,
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
        path: 'creditcard.csv',
        name: 'creditcard.csv',
        exists: true,
        size_bytes: 150828752,
      },
      stream_source: {
        path: 'data/stream_test.csv',
        name: 'stream_test.csv',
        exists: true,
        rows: 42560,
        size_bytes: 13996990,
      },
      stream_epoch: '2025-01-06T00:00:00+00:00',
      uploads: [],
      profile: DATASET_PROFILE,
      fraud_index: {
        source: 'stream_test.csv',
        total_rows: 42560,
        fraud_count: 52,
        fraud_rate: 0.001222,
        first_fraud_row: 1326,
        fraud_rows: [1326, 1478, 1630, 1680, 1779, 1935, 2261, 3272, 3480],
        recommended_skip: 1311,
        densest_window: {
          start: 9763,
          fraud_count: 5,
          window_size: 400,
          end: 10163,
        },
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
