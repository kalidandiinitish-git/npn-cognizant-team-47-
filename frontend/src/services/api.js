import axios from 'axios';
import { supabase } from '../lib/supabaseClient';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const apiBaseUrl = baseURL;

const client = axios.create({
  baseURL,
  timeout: 20000,
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

function describeError(error) {
  if (error.response) {
    const detail = error.response.data && error.response.data.detail;
    return {
      status: error.response.status,
      message:
        (typeof detail === 'string' && detail) ||
        `Request failed with status ${error.response.status}`,
    };
  }
  if (error.request) {
    return {
      status: 0,
      message: `Detection engine unreachable at ${baseURL}. Is the FastAPI service running?`,
    };
  }
  return { status: -1, message: error.message || 'Unexpected error' };
}

async function request(promise) {
  try {
    const response = await promise;
    return response.data;
  } catch (error) {
    const described = describeError(error);
    const wrapped = new Error(described.message);
    wrapped.status = described.status;
    throw wrapped;
  }
}

export const api = {
  health: () => request(client.get('/api/health')),
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
  investigations: (params = {}) =>
    request(client.get('/api/investigations', { params })),
  investigationMetrics: () => request(client.get('/api/investigations/metrics')),
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
    ),
  account: (accountId) => request(client.get(`/api/accounts/${encodeURIComponent(accountId)}`)),
  model: () => request(client.get('/api/model')),
  datasetInfo: () => request(client.get('/api/dataset/info')),
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
