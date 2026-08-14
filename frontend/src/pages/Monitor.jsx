import React, { useMemo, useState } from 'react';
import { PageHeader } from '../components/app/AppShell';
import { Card, CardHeader, StatTile, Tabs } from '../components/ui';
import { Icon } from '../components/Icons';
import { LatencyChart, RiskBandLegend } from '../components/app/widgets';
import { TransactionDetail, TransactionTable } from '../components/app/tables';
import { useStream } from '../context/StreamContext';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { RISK_ORDER } from '../utils/risk';
import { formatMs, formatNumber } from '../utils/format';

export default function Monitor() {
  useDocumentTitle('Live monitor');
  const { transactions, timeline, totals, latency, paused, setPaused, isRunning, streamStatus } =
    useStream();

  const [level, setLevel] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  const counts = useMemo(() => {
    const result = { all: transactions.length };
    RISK_ORDER.forEach((item) => {
      result[item] = transactions.filter((row) => row.risk_level === item).length;
    });
    return result;
  }, [transactions]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return transactions.filter((row) => {
      if (level !== 'all' && row.risk_level !== level) return false;
      if (!needle) return true;
      return [row.transaction_ref, row.account_id, row.merchant, row.merchant_category, row.location]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [transactions, level, query]);

  return (
    <>
      <PageHeader
        title="Live transaction monitor"
        subtitle="Every event the generator has produced, newest first. Click a row for the full context."
      >
        <button
          type="button"
          className={paused ? 'btn-primary btn-sm' : 'btn-outline btn-sm'}
          onClick={() => setPaused(!paused)}
          aria-pressed={paused}
        >
          <Icon name={paused ? 'play' : 'pause'} className="h-3.5 w-3.5" />
          {paused ? 'Resume feed' : 'Pause feed'}
        </button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Processed"
          value={totals ? formatNumber(totals.total_transactions) : '--'}
          hint={isRunning ? 'stream running' : 'stream idle'}
          icon="stream"
        />
        <StatTile
          label="Flagged"
          value={totals ? formatNumber(totals.fraud_transactions) : '--'}
          hint="risk score at or above 0.70"
          icon="alert"
        />
        <StatTile
          label="Throughput"
          value={totals ? totals.transactions_per_second : '--'}
          unit="tx/s"
          hint={
            streamStatus || totals
              ? `${formatNumber(
                  (streamStatus && streamStatus.invalid_records != null)
                    ? streamStatus.invalid_records
                    : (totals && totals.invalid_records != null)
                      ? totals.invalid_records
                      : 0,
                )} invalid records skipped`
              : null
          }
          icon="bolt"
        />
        <StatTile
          label="p95 latency"
          value={latency && latency.p95_ms !== null ? formatMs(latency.p95_ms) : '--'}
          hint={latency ? `max ${formatMs(latency.max_ms)}` : null}
          icon="clock"
        />
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader title="Inference latency over time" subtitle="Average per second" icon="clock" />
          <LatencyChart timeline={timeline} />
        </Card>
      </div>

      <div className="mt-4">
        <RiskBandLegend />
      </div>

      <div className="mt-4">
        <Card>
          <div className="flex flex-col gap-3 border-b border-hairline px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <Tabs
              ariaLabel="Filter by risk band"
              value={level}
              onChange={setLevel}
              items={[
                { value: 'all', label: 'All', count: counts.all },
                ...RISK_ORDER.map((item) => ({
                  value: item,
                  label: item.charAt(0).toUpperCase() + item.slice(1),
                  count: counts[item],
                })),
              ]}
            />

            <div className="relative w-full lg:w-[300px]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
                <Icon name="search" className="h-4 w-4" />
              </span>
              <label className="sr-only" htmlFor="monitor-search">
                Search transactions
              </label>
              <input
                id="monitor-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search reference, account, merchant"
                className="field-input py-2 pl-9 text-[13.5px]"
              />
            </div>
          </div>

          {paused ? (
            <div className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-[12.5px] text-amber-900">
              Feed paused. New transactions are still being scored and stored, they just are not
              rendered until you resume.
            </div>
          ) : null}

          <TransactionTable
            transactions={filtered}
            showLabel
            onSelect={setSelected}
            highlightFirst={!paused}
            emptyTitle={query || level !== 'all' ? 'Nothing matches this filter' : 'No transactions yet'}
            emptyDescription={
              query || level !== 'all'
                ? 'Clear the search or pick another risk band.'
                : 'Start the stream from the top bar to begin scoring.'
            }
          />

          <div className="flex items-center justify-between border-t border-hairline px-5 py-3 text-[12.5px] text-ink-500">
            <span>
              Showing {formatNumber(filtered.length)} of {formatNumber(transactions.length)} buffered
              transactions
            </span>
            <span>The engine keeps the most recent 500 in memory; Supabase holds the full history.</span>
          </div>
        </Card>
      </div>

      {selected ? (
        <TransactionDetail transaction={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}
