import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import api from '../services/api';
import { supabase } from '../lib/supabaseClient';
import useInterval from '../hooks/useInterval';

const RUNNING_POLL_MS = 2000;
const IDLE_POLL_MS = 8000;
const FEED_LIMIT = 120;

const StreamContext = createContext(null);

function mergeById(existing, incoming, key, limit) {
  const seen = new Set();
  const merged = [];
  [...incoming, ...existing].forEach((row) => {
    const identity = row[key];
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    merged.push(row);
  });
  return merged.slice(0, limit);
}

export function StreamProvider({ children }) {
  const [health, setHealth] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [investigations, setInvestigations] = useState([]);
  const [investigationMetrics, setInvestigationMetrics] = useState(null);
  const [model, setModel] = useState(null);
  const [dataset, setDataset] = useState(null);
  const [error, setError] = useState(null);
  const [initialising, setInitialising] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState(supabase ? 'connecting' : 'disabled');
  const [paused, setPaused] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const isRunning = Boolean(metrics && metrics.stream && metrics.stream.is_running);

  const refreshCore = useCallback(async () => {
    try {
      const [nextMetrics, feed, alertPayload, accountPayload] = await Promise.all([
        api.metrics(),
        api.recentTransactions(FEED_LIMIT),
        api.alerts(80),
        api.highRiskAccounts('medium', 60),
      ]);
      if (!mounted.current) return;
      setMetrics(nextMetrics);
      setTransactions(feed.transactions || []);
      setAlerts(alertPayload.alerts || []);
      setAccounts(accountPayload.accounts || []);
      setError(null);
      setLastUpdatedAt(new Date().toISOString());
    } catch (requestError) {
      if (mounted.current) setError(requestError.message);
    }
  }, []);

  const refreshInvestigations = useCallback(async () => {
    try {
      const [casePayload, caseMetrics] = await Promise.all([
        api.investigations({ limit: 200 }),
        api.investigationMetrics(),
      ]);
      if (!mounted.current) return null;
      setInvestigations(casePayload.cases || []);
      setInvestigationMetrics(caseMetrics || null);
      return casePayload;
    } catch (_requestError) {
      // Investigation polling is additive. A temporarily unavailable route must
      // never take down the live transaction dashboard.
      return null;
    }
  }, []);

  const pollCounter = useRef(0);

  const refreshReference = useCallback(async () => {
    try {
      const nextHealth = await api.health();
      if (mounted.current && nextHealth) setHealth(nextHealth);
    } catch (requestError) {
      if (mounted.current) setError(requestError.message);
    }
    try {
      const nextModel = await api.model();
      if (mounted.current && nextModel) setModel(nextModel);
    } catch (_requestError) {
      if (mounted.current) setModel((curr) => curr || null);
    }
    try {
      const nextDataset = await api.datasetInfo();
      if (mounted.current && nextDataset) setDataset(nextDataset);
    } catch (_requestError) {
      if (mounted.current) setDataset((curr) => curr || null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([refreshReference(), refreshCore(), refreshInvestigations()]);
      } finally {
        if (!cancelled && mounted.current) setInitialising(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshCore, refreshInvestigations, refreshReference]);

  useInterval(
    () => {
      if (!paused) {
        refreshCore();
        refreshInvestigations();
        // Only retry reference if not yet loaded (e.g. backend was offline at boot)
        if (!health || !dataset || !model) {
          refreshReference();
        }
      }
    },
    initialising ? null : isRunning ? RUNNING_POLL_MS : IDLE_POLL_MS,
  );

  // ---- Supabase Realtime -------------------------------------------------
  useEffect(() => {
    if (!supabase) return undefined;

    const channel = supabase
      .channel('fraudstream-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'transactions' },
        (payload) => {
          if (paused) return;
          setTransactions((current) =>
            mergeById(current, [payload.new], 'transaction_ref', FEED_LIMIT),
          );
          setLastUpdatedAt(new Date().toISOString());
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'fraud_alerts' },
        (payload) => {
          if (paused) return;
          setAlerts((current) => mergeById(current, [payload.new], 'transaction_id', 80));
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'account_risk' },
        (payload) => {
          if (paused || !payload.new) return;
          setAccounts((current) => {
            const next = current.filter((row) => row.account_id !== payload.new.account_id);
            next.push(payload.new);
            return next
              .sort((left, right) => Number(right.risk_score) - Number(left.risk_score))
              .slice(0, 60);
          });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'investigation_cases' },
        () => {
          if (!paused) refreshInvestigations();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'investigation_notes' },
        () => {
          if (!paused) refreshInvestigations();
        },
      )
      .subscribe((status) => {
        if (!mounted.current) return;
        if (status === 'SUBSCRIBED') setRealtimeStatus('connected');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeStatus('error');
        else if (status === 'CLOSED') setRealtimeStatus('closed');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [paused, refreshInvestigations]);

  // ---- Actions -----------------------------------------------------------
  const startStream = useCallback(
    async (options) => {
      setBusy(true);
      try {
        const response = await api.startStream(options);
        await Promise.all([refreshCore(), refreshInvestigations()]);
        setError(null);
        return response;
      } catch (requestError) {
        setError(requestError.message);
        throw requestError;
      } finally {
        setBusy(false);
      }
    },
    [refreshCore, refreshInvestigations],
  );

  const stopStream = useCallback(async () => {
    setBusy(true);
    try {
      const response = await api.stopStream();
      await Promise.all([refreshCore(), refreshInvestigations()]);
      return response;
    } catch (requestError) {
      setError(requestError.message);
      throw requestError;
    } finally {
      setBusy(false);
    }
  }, [refreshCore, refreshInvestigations]);

  const setAlertStatus = useCallback(
    async (transactionId, status) => {
      setAlerts((current) =>
        current.map((alert) =>
          alert.transaction_id === transactionId ? { ...alert, status } : alert,
        ),
      );
      try {
        await api.updateAlert(transactionId, status);
        await refreshInvestigations();
      } catch (requestError) {
        setError(requestError.message);
        throw requestError;
      }
    },
    [refreshInvestigations],
  );

  const getInvestigation = useCallback(async (caseId) => {
    const response = await api.investigation(caseId);
    return response.case;
  }, []);

  const assignInvestigation = useCallback(
    async (caseId, payload) => {
      try {
        const response = await api.assignInvestigation(caseId, payload);
        await refreshInvestigations();
        return response.case;
      } catch (requestError) {
        setError(requestError.message);
        throw requestError;
      }
    },
    [refreshInvestigations],
  );

  const addInvestigationNote = useCallback(
    async (caseId, payload) => {
      try {
        const response = await api.addInvestigationNote(caseId, payload);
        await refreshInvestigations();
        return response.case;
      } catch (requestError) {
        setError(requestError.message);
        throw requestError;
      }
    },
    [refreshInvestigations],
  );

  const setInvestigationStatus = useCallback(
    async (caseId, payload) => {
      try {
        const response = await api.updateInvestigationStatus(caseId, payload);
        await refreshInvestigations();
        return response.case;
      } catch (requestError) {
        setError(requestError.message);
        throw requestError;
      }
    },
    [refreshInvestigations],
  );

  const resolveInvestigation = useCallback(
    async (caseId, payload) => {
      try {
        const response = await api.resolveInvestigation(caseId, payload);
        await refreshInvestigations();
        return response.case;
      } catch (requestError) {
        setError(requestError.message);
        throw requestError;
      }
    },
    [refreshInvestigations],
  );

  const value = useMemo(
    () => ({
      health,
      metrics,
      transactions,
      alerts,
      accounts,
      investigations,
      investigationMetrics,
      model,
      dataset,
      error,
      initialising,
      busy,
      paused,
      setPaused,
      isRunning,
      lastUpdatedAt,
      realtimeStatus,
      engineOnline: Boolean((health && health.status === 'ok') || health || metrics),
      totals: (metrics && metrics.totals) || null,
      latency: (metrics && metrics.latency) || null,
      riskDistribution: (metrics && metrics.risk_distribution) || [],
      timeline: (metrics && metrics.timeline) || [],
      liveQuality: (metrics && metrics.live_quality) || null,
      streamStatus: (metrics && metrics.stream) || null,
      persistence: (metrics && metrics.persistence) || null,
      refresh: refreshCore,
      refreshReference,
      refreshInvestigations,
      startStream,
      stopStream,
      setAlertStatus,
      getInvestigation,
      assignInvestigation,
      addInvestigationNote,
      setInvestigationStatus,
      resolveInvestigation,
    }),
    [
      health,
      metrics,
      transactions,
      alerts,
      accounts,
      investigations,
      investigationMetrics,
      model,
      dataset,
      error,
      initialising,
      busy,
      paused,
      isRunning,
      lastUpdatedAt,
      realtimeStatus,
      refreshCore,
      refreshReference,
      refreshInvestigations,
      startStream,
      stopStream,
      setAlertStatus,
      getInvestigation,
      assignInvestigation,
      addInvestigationNote,
      setInvestigationStatus,
      resolveInvestigation,
    ],
  );

  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

export function useStream() {
  const context = useContext(StreamContext);
  if (!context) {
    throw new Error('useStream must be used inside StreamProvider');
  }
  return context;
}

export default StreamContext;
