import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/app/AppShell';
import { Banner, Card, CardHeader, EmptyState, Sparkline, StatTile } from '../components/ui';
import { Icon } from '../components/Icons';
import {
  LatencyPanel,
  RiskDistributionPanel,
  ThroughputChart,
} from '../components/app/widgets';
import { AlertTable, TransactionDetail, TransactionTable } from '../components/app/tables';
import { useStream } from '../context/StreamContext';
import useDocumentTitle from '../hooks/useDocumentTitle';
import {
  formatCompact,
  formatDuration,
  formatMs,
  formatNumber,
  formatPercent,
  formatScore,
} from '../utils/format';

export default function Dashboard() {
  useDocumentTitle('Overview');
  const {
    totals,
    latency,
    riskDistribution,
    timeline,
    transactions,
    alerts,
    accounts,
    streamStatus,
    liveQuality,
    health,
    error,
    initialising,
    isRunning,
    setAlertStatus,
  } = useStream();

  const [selected, setSelected] = useState(null);
  const [statusBusy, setStatusBusy] = useState(null);

  const sparkline = useMemo(() => (timeline || []).map((point) => point.transactions), [timeline]);
  const openAlerts = alerts.filter((alert) => alert.status === 'open');

  const onStatusChange = async (transactionId, status) => {
    setStatusBusy(transactionId);
    try {
      await setAlertStatus(transactionId, status);
    } finally {
      setStatusBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Detection overview"
        subtitle={
          isRunning
            ? `Streaming since ${formatDuration(streamStatus ? streamStatus.elapsed_seconds : 0)} ago`
            : 'Stream is idle. Start it from the top bar to score the held-out transactions.'
        }
      >
        <Link to="/app/monitor" className="btn-outline btn-sm">
          <Icon name="activity" className="h-3.5 w-3.5" />
          Live monitor
        </Link>
        <Link to="/app/analytics" className="btn-outline btn-sm">
          <Icon name="chart" className="h-3.5 w-3.5" />
          Model analytics
        </Link>
      </PageHeader>

      {error ? (
        <div className="mb-5">
          <Banner tone="error" title="Detection engine problem">
            {error}
          </Banner>
        </div>
      ) : null}

      {health && health.model_loaded === false ? (
        <div className="mb-5">
          <Banner tone="warn" title="No trained model loaded">
            Run <code className="mono">python -m src.training.train</code> in{' '}
            <code className="mono">ml-engine</code> to produce{' '}
            <code className="mono">fraud_model.joblib</code>, then reload this page.
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total transactions"
          value={totals ? formatNumber(totals.total_transactions) : '--'}
          hint={streamStatus ? `${formatNumber(streamStatus.source_total_rows)} available in split` : null}
          icon="stream"
        >
          <div className="mt-3">
            <Sparkline points={sparkline} className="text-ink-900/40" />
          </div>
        </StatTile>

        <StatTile
          label="Fraud detected"
          value={totals ? formatNumber(totals.fraud_transactions) : '--'}
          hint={`${totals ? formatNumber(totals.critical_alerts) : 0} critical`}
          delta={totals ? formatPercent(totals.fraud_detection_rate) : null}
          deltaTone={totals && totals.fraud_transactions > 0 ? 'up' : 'neutral'}
          icon="alert"
          tone={totals && totals.critical_alerts > 0 ? 'critical' : 'default'}
        />

        <StatTile
          label="High-risk accounts"
          value={totals ? formatNumber(totals.high_risk_accounts) : '--'}
          hint={totals ? `${formatNumber(totals.monitored_accounts)} accounts monitored` : null}
          icon="users"
        />

        <StatTile
          label="Avg inference latency"
          value={latency && latency.average_ms !== null ? formatMs(latency.average_ms) : '--'}
          hint={latency ? `p95 ${formatMs(latency.p95_ms)} - budget ${formatMs(latency.target_ms, 0)}` : null}
          icon="bolt"
          delta={latency && latency.within_target ? 'within budget' : null}
          deltaTone={latency && latency.within_target ? 'down' : 'neutral'}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardHeader
            title="Arrival and flag rate"
            subtitle="One bucket per second while the stream runs"
            icon="activity"
            action={
              <span className="tabular text-[12.5px] text-ink-500">
                {totals ? `${totals.transactions_per_second}/s` : '--'}
              </span>
            }
          />
          <ThroughputChart timeline={timeline} />
        </Card>

        <Card>
          <CardHeader title="Risk distribution" subtitle="Share of scored transactions per band" icon="target" />
          <RiskDistributionPanel distribution={riskDistribution} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr_1fr]">
        <Card>
          <CardHeader title="Prediction latency" subtitle="Rolling window" icon="clock" />
          <LatencyPanel latency={latency} />
        </Card>

        <Card>
          <CardHeader
            title="Live scoring quality"
            subtitle="Measured against dataset labels as they stream"
            icon="chart"
          />
          {liveQuality && liveQuality.true_positives + liveQuality.false_negatives > 0 ? (
            <div className="px-5 py-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  ['Precision', liveQuality.precision],
                  ['Recall', liveQuality.recall],
                  ['F1', liveQuality.f1_score],
                  ['False positive rate', liveQuality.false_positive_rate],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="eyebrow">{label}</p>
                    <p className="tabular mt-1 text-[20px] font-semibold text-ink-900">
                      {formatScore(value, 3)}
                    </p>
                  </div>
                ))}
              </div>
              <dl className="mt-4 grid grid-cols-4 gap-2 border-t border-hairline pt-3 text-center">
                {[
                  ['TP', liveQuality.true_positives, 'text-emerald-600'],
                  ['FP', liveQuality.false_positives, 'text-amber-600'],
                  ['FN', liveQuality.false_negatives, 'text-rose-600'],
                  ['TN', formatCompact(liveQuality.true_negatives), 'text-ink-700'],
                ].map(([label, value, tone]) => (
                  <div key={label}>
                    <dd className={`tabular text-[15px] font-semibold ${tone}`}>{value}</dd>
                    <dt className="text-2xs uppercase tracking-wide text-ink-500">{label}</dt>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <EmptyState
              icon="info"
              title="Waiting for labelled fraud"
              description="Live precision and recall appear once the stream reaches labelled fraudulent transactions."
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Top high-risk accounts"
            subtitle="Ranked by aggregated risk"
            icon="users"
            action={
              <Link to="/app/accounts" className="text-[12.5px] font-semibold text-brand-600 hover:text-brand-700">
                View all
              </Link>
            }
          />
          {accounts.length ? (
            <ul className="divide-y divide-hairline">
              {accounts.slice(0, 5).map((account) => (
                <li key={account.account_id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="mono truncate text-ink-900">{account.account_id}</p>
                    <p className="text-2xs text-ink-500">
                      {formatNumber(account.suspicious_count)} suspicious of{' '}
                      {formatNumber(account.transaction_count)}
                    </p>
                  </div>
                  <span className="tabular text-[15px] font-semibold text-ink-900">
                    {formatScore(account.risk_score, 2)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon="users"
              title="No accounts flagged yet"
              description="Accounts escalate after repeated suspicious transactions."
            />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardHeader
            title="Latest scored transactions"
            subtitle="Newest first"
            icon="stream"
            action={
              <Link to="/app/monitor" className="text-[12.5px] font-semibold text-brand-600 hover:text-brand-700">
                Open monitor
              </Link>
            }
          />
          <TransactionTable
            transactions={transactions.slice(0, 8)}
            onSelect={setSelected}
            emptyDescription={
              initialising
                ? 'Connecting to the detection engine.'
                : 'Start the stream to begin scoring the held-out transactions.'
            }
          />
        </Card>

        <Card>
          <CardHeader
            title="Open alerts"
            subtitle={`${openAlerts.length} awaiting triage`}
            icon="alert"
            action={
              <Link to="/app/alerts" className="text-[12.5px] font-semibold text-brand-600 hover:text-brand-700">
                Triage
              </Link>
            }
          />
          <div className="scroll-thin max-h-[420px] overflow-y-auto">
            <AlertTable
              alerts={alerts.slice(0, 6)}
              onStatusChange={onStatusChange}
              busyId={statusBusy}
            />
          </div>
        </Card>
      </div>

      {selected ? (
        <TransactionDetail transaction={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}
