import axios from 'axios';
import { supabase } from '../lib/supabaseClient';

// Live Render deployment of ml-engine (render.yaml). Only the default for a
// build with no VITE_API_URL - when it goes stale every production call fails,
// so it has to point at a host that actually answers.
const PRODUCTION_ENGINE_URL = 'https://fraudstream-ai-engine-0t6q.onrender.com';

const baseURL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? PRODUCTION_ENGINE_URL : 'http://localhost:8000');

export const apiBaseUrl = baseURL;

// A free-tier instance that has gone to sleep needs tens of seconds to answer
// its first request, so a short timeout reports a waking engine as a dead one.
const REQUEST_TIMEOUT_MS = 10000;
// Render's free plan stops the instance after 15 minutes idle and a cold boot
// here (pandas, scikit-learn, xgboost, then the model artifacts) runs long, so
// health has to outwait the boot.
const HEALTH_TIMEOUT_MS = 90000;
// A 250 MB CSV crossing a conference wifi needs far longer than a JSON call.
const UPLOAD_TIMEOUT_MS = 300000;

const client = axios.create({
  baseURL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Whether calls are reaching the detection engine.
 *
 *   live: null   no request has completed yet (starting up / waking a cold host)
 *   live: true   the last request reached the engine
 *   live: false  the last request failed
 *
 * This drives the banner. Every number in this dashboard is measured by the
 * engine; when the engine cannot be reached the UI says so and shows nothing,
 * rather than substituting figures a fraud console cannot support.
 */
const engineStatus = {
  live: null,
  lastError: null,
  lastSuccessAt: null,
  lastFailureAt: null,
};

//: A sleeping host answers nothing until it has booted, which takes longer than
//: any single request is willing to wait. Reporting the first timeout as
//: "unreachable" would replace the "still waking" banner with an error while the
//: engine is on its way up. Timeouts are held as "not answered yet" until the
//: host has had a realistic boot's worth of time.
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

/**
 * Turn an axios failure into a message worth showing a human.
 *
 * FastAPI puts the useful part in `detail` - "bank_export.csv is missing 30
 * required columns..." - and axios buries it under a generic "Request failed
 * with status code 400". Surfacing the wrong one of those is the difference
 * between an analyst fixing their file and one filing a bug.
 */
function toReadableError(error) {
  const detail = error && error.response && error.response.data
    ? error.response.data.detail
    : null;

  if (typeof detail === 'string' && detail.trim()) {
    return new Error(detail);
  }
  // Pydantic validation errors arrive as a list of {loc, msg, type}.
  if (Array.isArray(detail) && detail.length) {
    const messages = detail
      .map((item) => (item && item.msg ? item.msg : null))
      .filter(Boolean);
    if (messages.length) return new Error(messages.join('; '));
  }
  if (looksLikeHostAsleep(error)) {
    return new Error(
      'The detection engine did not answer. A free-tier instance can take up to ' +
        'a minute to wake; if this persists it is not running.',
    );
  }
  // The engine verifies the Supabase access token this client attaches. A 401
  // is therefore a session problem, not an outage, and saying "Engine returned
  // 401" sends people to check a service that is working perfectly.
  if (error && error.response && error.response.status === 401) {
    return new Error(
      'The detection engine rejected this session. Sign out and sign in again.',
    );
  }
  if (error && error.response) {
    return new Error(`Engine returned ${error.response.status}.`);
  }
  return new Error((error && error.message) || 'Request failed.');
}

async function request(promise) {
  try {
    const response = await promise;
    setEngineLive(true, null);
    return response.data;
  } catch (error) {
    // A 4xx is the engine answering, and answering is what "live" means. Only a
    // transport failure means the engine could not be reached - counting a
    // rejected upload as an outage would flip the whole dashboard to offline.
    setEngineLive(!looksLikeHostAsleep(error), error);
    throw toReadableError(error);
  }
}

export const api = {
  health: () => request(client.get('/api/health', { timeout: HEALTH_TIMEOUT_MS })),
  metrics: () => request(client.get('/api/metrics')),
  streamStatus: () => request(client.get('/api/stream/status')),
  startStream: (payload) => request(client.post('/api/stream/start', payload || {})),
  stopStream: () => request(client.post('/api/stream/stop')),
  predict: (payload) => request(client.post('/api/predict', payload)),
  recentTransactions: (limit = 60, riskLevel) =>
    request(
      client.get('/api/transactions/recent', {
        params: { limit, risk_level: riskLevel || undefined },
      }),
    ),
  alerts: (limit = 60, riskLevel) =>
    request(client.get('/api/alerts', { params: { limit, risk_level: riskLevel || undefined } })),
  updateAlert: (transactionId, status) =>
    request(client.patch(`/api/alerts/${encodeURIComponent(transactionId)}`, { status })),
  investigations: (params = {}) => request(client.get('/api/investigations', { params })),
  investigationMetrics: () => request(client.get('/api/investigations/metrics')),
  investigation: (caseId) =>
    request(client.get(`/api/investigations/${encodeURIComponent(caseId)}`)),
  assignInvestigation: (caseId, payload) =>
    request(client.patch(`/api/investigations/${encodeURIComponent(caseId)}/assignment`, payload)),
  addInvestigationNote: (caseId, payload) =>
    request(client.post(`/api/investigations/${encodeURIComponent(caseId)}/notes`, payload)),
  updateInvestigationStatus: (caseId, payload) =>
    request(client.patch(`/api/investigations/${encodeURIComponent(caseId)}/status`, payload)),
  resolveInvestigation: (caseId, payload) =>
    request(client.post(`/api/investigations/${encodeURIComponent(caseId)}/resolution`, payload)),
  highRiskAccounts: (minimumLevel = 'high', limit = 50) =>
    request(
      client.get('/api/accounts/high-risk', {
        params: { minimum_level: minimumLevel, limit },
      }),
    ),
  account: (accountId) => request(client.get(`/api/accounts/${encodeURIComponent(accountId)}`)),
  model: () => request(client.get('/api/model')),
  datasetInfo: () => request(client.get('/api/dataset/info')),
  /**
   * Send the file to the engine and wait for its verdict.
   *
   * The engine is the only thing that can say whether a CSV is scoreable, so
   * this must be the answer the page reports. Parsing the file in the browser
   * and posting to the engine in the background produced a "ready to stream"
   * banner for files the engine had never received and could not read.
   */
  uploadDataset: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request(
      client.post('/api/dataset/upload', form, {
        // Let the browser set the multipart boundary; a fixed Content-Type here
        // produces a body FastAPI cannot parse.
        headers: { 'Content-Type': undefined },
        timeout: UPLOAD_TIMEOUT_MS,
      }),
    );
  },
};

export default api;
