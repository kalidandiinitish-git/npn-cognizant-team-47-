import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, Badge, EmptyState, RiskBadge, TableShell } from '../ui';
import { Icon } from '../Icons';
import { AccountSignalBars } from './widgets';
import {
  ALERT_STATUSES,
  ALERT_STATUS_STYLES,
  alertTypeLabel,
  latencyTone,
  riskMeta,
} from '../../utils/risk';
import {
  formatClock,
  formatCurrency,
  formatDateTime,
  formatMs,
  formatNumber,
  formatRelative,
  formatScore,
  titleCase,
} from '../../utils/format';

export function TransactionTable({
  transactions,
  showLabel = false,
  onSelect,
  emptyTitle = 'No transactions yet',
  emptyDescription = 'Start the stream to begin scoring the held-out transactions.',
  highlightFirst = true,
}) {
  if (!transactions || !transactions.length) {
    return <EmptyState icon="activity" title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <TableShell>
      <thead>
        <tr>
          <th className="th">Transaction</th>
          <th className="th">Merchant</th>
          <th className="th text-right">Amount</th>
          <th className="th">Risk score</th>
          <th className="th">Band</th>
          <th className="th text-right">Latency</th>
          <th className="th text-right">Event time</th>
          {showLabel ? <th className="th text-center">Label</th> : null}
        </tr>
      </thead>
      <tbody>
        {transactions.map((row, index) => {
          const meta = riskMeta(row.risk_level);
          const interactive = Boolean(onSelect);
          return (
            <tr
              key={row.transaction_ref || `${row.account_id}-${index}`}
              className={`${index === 0 && highlightFirst ? 'animate-fade-in-row' : ''} ${
                interactive ? 'cursor-pointer transition-colors hover:bg-paper' : ''
              }`}
              onClick={interactive ? () => onSelect(row) : undefined}
              tabIndex={interactive ? 0 : undefined}
              onKeyDown={
                interactive
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(row);
                      }
                    }
                  : undefined
              }
            >
              <td className="td">
                <span className="mono block text-ink-900">{row.transaction_ref}</span>
                <span className="text-2xs text-ink-500">
                  {row.account_id}
                  {row.card_last4 ? ` - card ****${row.card_last4}` : ''}
                </span>
              </td>
              <td className="td">
                <span className="block text-ink-800">{row.merchant || '--'}</span>
                <span className="text-2xs text-ink-500">{row.merchant_category || row.location}</span>
              </td>
              <td className="td tabular text-right font-medium">
                {formatCurrency(row.transaction_amount)}
              </td>
              <td className="td w-[132px]">
                <span className="tabular block font-medium text-ink-900">
                  {formatScore(row.risk_score)}
                </span>
                <span className="mt-1 block">
                  <Bar value={row.risk_score} max={1} className={meta.bar} height="h-1" />
                </span>
              </td>
              <td className="td">
                <RiskBadge level={row.risk_level} />
              </td>
              <td className={`td tabular text-right ${latencyTone(row.inference_latency_ms)}`}>
                {formatMs(row.inference_latency_ms)}
              </td>
              <td className="td text-right text-ink-500">{formatDateTime(row.transaction_time)}</td>
              {showLabel ? (
                <td className="td text-center">
                  {row.actual_label === null || row.actual_label === undefined ? (
                    <span className="text-ink-400">--</span>
                  ) : Number(row.actual_label) === 1 ? (
                    <Badge className="border-rose-200 bg-rose-50 text-rose-700">Fraud</Badge>
                  ) : (
                    <Badge className="border-slate-200 bg-slate-50 text-ink-600">Legit</Badge>
                  )}
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

export function TransactionDetail({ transaction, onClose }) {
  if (!transaction) return null;
  const behaviour = transaction.behaviour || {};
  const meta = riskMeta(transaction.risk_level);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Transaction detail">
      <div className="flex-1 bg-ink-950/35" onClick={onClose} aria-hidden="true" />
      <div className="scroll-thin w-full max-w-[420px] overflow-y-auto border-l border-hairline bg-white shadow-panel">
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div>
            <p className="eyebrow">Transaction</p>
            <p className="mono mt-1 text-[15px] text-ink-900">{transaction.transaction_ref}</p>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Close detail">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-hairline px-5 py-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="eyebrow">Risk score</p>
              <p className="tabular mt-1 text-[32px] font-semibold leading-none text-ink-900">
                {formatScore(transaction.risk_score)}
              </p>
            </div>
            <RiskBadge level={transaction.risk_level} />
          </div>
          <div className="mt-3">
            <Bar value={transaction.risk_score} max={1} className={meta.bar} />
          </div>
          <p className="mt-2 text-[12.5px] text-ink-500">
            Decision: <span className="font-medium text-ink-800">{transaction.decision}</span> - model
            probability {formatScore(transaction.model_score, 4)}
          </p>
        </div>

        <dl className="px-5 py-2">
          {[
            ['Account', transaction.account_id, true],
            ['Card', transaction.card_last4 ? `**** ${transaction.card_last4}` : '--', true],
            ['Amount', formatCurrency(transaction.transaction_amount)],
            ['Merchant', transaction.merchant],
            ['Category', transaction.merchant_category],
            ['Location', transaction.location],
            ['Channel', titleCase(transaction.channel)],
            ['Event time', formatDateTime(transaction.transaction_time)],
            ['Inference latency', formatMs(transaction.inference_latency_ms)],
            ['Processing latency', formatMs(transaction.processing_latency_ms)],
            ['Account risk level', titleCase(transaction.account_risk_level)],
          ].map(([label, value, mono]) => (
            <div
              key={label}
              className="flex items-start justify-between gap-4 border-b border-hairline/70 py-2.5 last:border-0"
            >
              <dt className="text-[12.5px] text-ink-500">{label}</dt>
              <dd className={`text-right text-[13px] font-medium text-ink-900 ${mono ? 'mono' : 'tabular'}`}>
                {value || '--'}
              </dd>
            </div>
          ))}
        </dl>

        <div className="border-t border-hairline px-5 py-4">
          <p className="eyebrow">Behavioural context</p>
          <p className="mt-1 text-[12.5px] text-ink-500">
            Computed from this account&apos;s prior activity only, never from the transaction itself.
          </p>
          <dl className="mt-3 space-y-2">
            {[
              ['Prior transactions', formatNumber(behaviour.account_transaction_count)],
              ['Average amount', formatCurrency(behaviour.account_average_amount)],
              ['Amount deviation', formatScore(behaviour.amount_deviation, 2)],
              [
                'Since previous',
                behaviour.seconds_since_previous === null ||
                behaviour.seconds_since_previous === undefined
                  ? 'first seen'
                  : `${formatNumber(behaviour.seconds_since_previous)} s`,
              ],
              ['Velocity, 1 hour', formatNumber(behaviour.transaction_velocity_1h)],
              ['Recent locations', formatNumber(behaviour.distinct_locations_recent)],
              ['High value', behaviour.is_high_value ? 'yes' : 'no'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 text-[12.5px]">
                <dt className="text-ink-500">{label}</dt>
                <dd className="tabular font-medium text-ink-900">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {transaction.actual_label !== null && transaction.actual_label !== undefined ? (
          <div className="border-t border-hairline bg-paper px-5 py-4">
            <p className="eyebrow">Ground truth</p>
            <p className="mt-1.5 text-[13px] text-ink-700">
              The dataset labels this transaction as{' '}
              <span className="font-semibold">
                {Number(transaction.actual_label) === 1 ? 'fraud' : 'legitimate'}
              </span>
              . Labels are kept for evaluation only and are never fed to the model.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AlertTable({ alerts, onStatusChange, busyId }) {
  if (!alerts || !alerts.length) {
    return (
      <EmptyState
        icon="shield"
        title="No alerts raised"
        description="Alerts appear when a transaction scores 0.70 or above on the risk scale."
      />
    );
  }

  return (
    <TableShell>
      <thead>
        <tr>
          <th className="th">Severity</th>
          <th className="th">Alert</th>
          <th className="th">Account</th>
          <th className="th text-right">Amount</th>
          <th className="th text-right">Risk</th>
          <th className="th">Status</th>
          <th className="th text-right">Raised</th>
        </tr>
      </thead>
      <tbody>
        {alerts.map((alert, index) => (
          <tr key={`${alert.transaction_id}-${index}`} className={index === 0 ? 'animate-fade-in-row' : ''}>
            <td className="td">
              <RiskBadge level={alert.risk_level} />
            </td>
            <td className="td">
              <span className="block font-medium text-ink-900">{alertTypeLabel(alert.alert_type)}</span>
              {alert.case_id ? (
                <Link
                  to={`/app/investigations?case=${encodeURIComponent(alert.case_id)}`}
                  className="mono text-2xs text-brand-600 hover:text-brand-700 hover:underline"
                  title="Open investigation"
                >
                  {alert.transaction_id}
                </Link>
              ) : (
                <span className="mono text-2xs text-ink-500">{alert.transaction_id}</span>
              )}
            </td>
            <td className="td">
              <span className="mono block text-ink-800">{alert.account_id}</span>
              <span className="text-2xs text-ink-500">{alert.location || alert.merchant}</span>
            </td>
            <td className="td tabular text-right">{formatCurrency(alert.transaction_amount)}</td>
            <td className="td tabular text-right font-medium">{formatScore(alert.risk_score)}</td>
            <td className="td">
              <label className="sr-only" htmlFor={`status-${alert.transaction_id}`}>
                Alert status for {alert.transaction_id}
              </label>
              <select
                id={`status-${alert.transaction_id}`}
                value={alert.status}
                disabled={busyId === alert.transaction_id}
                onChange={(event) => onStatusChange(alert.transaction_id, event.target.value)}
                className={`rounded-full border px-2.5 py-1 text-2xs font-semibold capitalize focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${
                  ALERT_STATUS_STYLES[alert.status] || ALERT_STATUS_STYLES.open
                }`}
              >
                {ALERT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </td>
            <td className="td text-right text-ink-500">
              <span className="block">{formatClock(alert.created_at)}</span>
              <span className="text-2xs">{formatRelative(alert.created_at)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

export function AccountTable({ accounts }) {
  const [expanded, setExpanded] = useState(null);

  if (!accounts || !accounts.length) {
    return (
      <EmptyState
        icon="users"
        title="No accounts flagged"
        description="Accounts escalate once repeated suspicious activity accumulates."
      />
    );
  }

  return (
    <TableShell>
      <thead>
        <tr>
          <th className="th">Account</th>
          <th className="th">Account risk</th>
          <th className="th">Level</th>
          <th className="th text-right">Transactions</th>
          <th className="th text-right">Suspicious</th>
          <th className="th text-right">Peak score</th>
          <th className="th text-right">Last activity</th>
          <th className="th" aria-label="Expand" />
        </tr>
      </thead>
      <tbody>
        {accounts.map((account) => {
          const meta = riskMeta(account.risk_level);
          const isOpen = expanded === account.account_id;
          return (
            <React.Fragment key={account.account_id}>
              <tr className={isOpen ? 'bg-paper' : ''}>
                <td className="td mono text-ink-900">{account.account_id}</td>
                <td className="td w-[150px]">
                  <span className="tabular block font-medium text-ink-900">
                    {formatScore(account.risk_score)}
                  </span>
                  <span className="mt-1 block">
                    <Bar value={account.risk_score} max={1} className={meta.bar} height="h-1" />
                  </span>
                </td>
                <td className="td">
                  <RiskBadge level={account.risk_level} />
                </td>
                <td className="td tabular text-right">{formatNumber(account.transaction_count)}</td>
                <td className="td tabular text-right font-medium text-brand-600">
                  {formatNumber(account.suspicious_count)}
                </td>
                <td className="td tabular text-right">{formatScore(account.maximum_risk_score)}</td>
                <td className="td text-right text-ink-500">{formatDateTime(account.last_activity)}</td>
                <td className="td text-right">
                  {account.signals ? (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setExpanded(isOpen ? null : account.account_id)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Hide' : 'Show'} signals for ${account.account_id}`}
                    >
                      <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} className="h-4 w-4" />
                    </button>
                  ) : null}
                </td>
              </tr>
              {isOpen && account.signals ? (
                <tr>
                  <td className="border-b border-hairline bg-paper px-4 py-4" colSpan={8}>
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                      <div>
                        <p className="eyebrow">Weighted risk signals</p>
                        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">
                          Each signal is normalised to 0-1 and combined with the weights defined in
                          the risk engine.
                        </p>
                      </div>
                      <AccountSignalBars signals={account.signals} />
                    </div>
                  </td>
                </tr>
              ) : null}
            </React.Fragment>
          );
        })}
      </tbody>
    </TableShell>
  );
}
