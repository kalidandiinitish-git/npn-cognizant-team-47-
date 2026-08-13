import React, { useMemo, useState } from 'react';
import { PageHeader } from '../components/app/AppShell';
import { Banner, Card, CardHeader, StatTile, Tabs } from '../components/ui';
import { AlertTable } from '../components/app/tables';
import { useStream } from '../context/StreamContext';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { ALERT_STATUSES, alertTypeLabel } from '../utils/risk';
import { formatNumber } from '../utils/format';

export default function Alerts() {
  useDocumentTitle('Fraud alerts');
  const { alerts, totals, setAlertStatus } = useStream();

  const [status, setStatus] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const counts = useMemo(() => {
    const result = { all: alerts.length };
    ALERT_STATUSES.forEach((item) => {
      result[item] = alerts.filter((alert) => alert.status === item).length;
    });
    return result;
  }, [alerts]);

  const byType = useMemo(() => {
    const tally = new Map();
    alerts.forEach((alert) => {
      tally.set(alert.alert_type, (tally.get(alert.alert_type) || 0) + 1);
    });
    return [...tally.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5);
  }, [alerts]);

  const filtered = alerts.filter((alert) => {
    if (status !== 'all' && alert.status !== status) return false;
    if (severity !== 'all' && alert.risk_level !== severity) return false;
    return true;
  });

  const onStatusChange = async (transactionId, nextStatus) => {
    setBusyId(transactionId);
    setError(null);
    try {
      await setAlertStatus(transactionId, nextStatus);
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Fraud alerts"
        subtitle="Raised automatically when a transaction reaches a risk score of 0.70 or above."
      />

      {error ? (
        <div className="mb-5">
          <Banner tone="error" title="Could not update the alert">
            {error}
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total alerts" value={formatNumber(alerts.length)} icon="alert" />
        <StatTile
          label="Critical"
          value={formatNumber(totals ? totals.critical_alerts : 0)}
          hint="risk 0.90 and above"
          icon="shield"
          tone={totals && totals.critical_alerts > 0 ? 'critical' : 'default'}
        />
        <StatTile label="Awaiting triage" value={formatNumber(counts.open || 0)} icon="clock" />
        <StatTile
          label="Resolved"
          value={formatNumber((counts.resolved || 0) + (counts.dismissed || 0))}
          hint="resolved or dismissed"
          icon="check"
        />
      </div>

      {byType.length ? (
        <div className="mt-4">
          <Card>
            <CardHeader title="Alert reasons" subtitle="Why the engine escalated" icon="filter" />
            <ul className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-5">
              {byType.map(([type, count]) => (
                <li key={type} className="bg-white px-4 py-3.5">
                  <p className="tabular text-[20px] font-semibold leading-none text-ink-900">
                    {formatNumber(count)}
                  </p>
                  <p className="mt-1.5 text-[12.5px] text-ink-600">{alertTypeLabel(type)}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <div className="mt-4">
        <Card>
          <div className="flex flex-col gap-3 border-b border-hairline px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <Tabs
              ariaLabel="Filter by status"
              value={status}
              onChange={setStatus}
              items={[
                { value: 'all', label: 'All', count: counts.all },
                ...ALERT_STATUSES.map((item) => ({
                  value: item,
                  label: item.charAt(0).toUpperCase() + item.slice(1),
                  count: counts[item],
                })),
              ]}
            />
            <Tabs
              ariaLabel="Filter by severity"
              value={severity}
              onChange={setSeverity}
              items={[
                { value: 'all', label: 'Any severity' },
                { value: 'high', label: 'High' },
                { value: 'critical', label: 'Critical' },
              ]}
            />
          </div>

          <AlertTable alerts={filtered} onStatusChange={onStatusChange} busyId={busyId} />

          <div className="border-t border-hairline px-5 py-3 text-[12.5px] text-ink-500">
            Status changes are written to Supabase. Analysts can update the status column only, which
            is enforced by a column-level grant rather than app logic.
          </div>
        </Card>
      </div>
    </>
  );
}
