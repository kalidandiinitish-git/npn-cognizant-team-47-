import React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Bar as MeterBar, Card, CardHeader, EmptyState } from '../ui';
import { Icon } from '../Icons';
import { RISK_LEVELS, RISK_ORDER, latencyTone, riskMeta } from '../../utils/risk';
import { formatClock, formatMs, formatNumber, formatScore, titleCase } from '../../utils/format';

const AXIS = {
  stroke: '#9AA4B5',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};

function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-md border border-hairline bg-white px-3 py-2 shadow-lift">
      {label ? <p className="mono mb-1 text-ink-500">{label}</p> : null}
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2 text-[12.5px]">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-ink-600">{entry.name}</span>
          <span className="tabular ml-auto font-medium text-ink-900">
            {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
            {unit || ''}
          </span>
        </p>
      ))}
    </div>
  );
}

export function ThroughputChart({ timeline }) {
  const data = (timeline || []).map((point) => ({
    time: formatClock(point.timestamp),
    Transactions: point.transactions,
    Flagged: point.flagged,
    latency: point.average_latency_ms,
  }));

  if (!data.length) {
    return (
      <EmptyState
        icon="activity"
        title="No stream activity yet"
        description="Start the stream and the arrival rate will plot here, one bucket per second."
      />
    );
  }

  return (
    <div className="h-[248px] px-2 pb-3 pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 12, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="fillTransactions" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0B1220" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#0B1220" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="fillFlagged" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E8582A" stopOpacity="0.26" />
              <stop offset="100%" stopColor="#E8582A" stopOpacity="0" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#EDEFF3" vertical={false} />
          <XAxis dataKey="time" {...AXIS} minTickGap={26} />
          <YAxis {...AXIS} width={46} allowDecimals={false} />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="Transactions"
            stroke="#0B1220"
            strokeWidth={1.8}
            fill="url(#fillTransactions)"
          />
          <Area
            type="monotone"
            dataKey="Flagged"
            stroke="#E8582A"
            strokeWidth={1.8}
            fill="url(#fillFlagged)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LatencyChart({ timeline }) {
  const data = (timeline || []).map((point) => ({
    time: formatClock(point.timestamp),
    'Avg latency': point.average_latency_ms,
  }));

  if (!data.length) {
    return (
      <EmptyState
        icon="clock"
        title="Latency chart is waiting for data"
        description="Per-second average inference latency appears once transactions start flowing."
      />
    );
  }

  return (
    <div className="h-[200px] px-2 pb-3 pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 12, left: -6, bottom: 0 }}>
          <CartesianGrid stroke="#EDEFF3" vertical={false} />
          <XAxis dataKey="time" {...AXIS} minTickGap={26} />
          {/* Sub-millisecond values need a wider gutter or the labels clip. */}
          <YAxis
            {...AXIS}
            width={62}
            tickFormatter={(value) => `${Number(value).toFixed(1)} ms`}
          />
          <Tooltip content={<ChartTooltip unit=" ms" />} />
          <Line
            type="monotone"
            dataKey="Avg latency"
            stroke="#E8582A"
            strokeWidth={1.9}
            dot={{ r: 2, fill: '#E8582A', strokeWidth: 0 }}
            activeDot={{ r: 3.5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RiskDistributionPanel({ distribution }) {
  const rows = RISK_ORDER.map((level) => {
    const found = (distribution || []).find((entry) => entry.level === level);
    return {
      level,
      count: found ? found.count : 0,
      percentage: found ? found.percentage : 0,
    };
  });
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="px-5 py-4">
      {total === 0 ? (
        <p className="py-6 text-center text-[13px] text-ink-500">
          Risk bands populate as transactions are scored.
        </p>
      ) : (
        <>
          <div className="flex h-2 overflow-hidden rounded-full bg-ink-900/[0.06]" aria-hidden="true">
            {rows.map((row) =>
              row.percentage > 0 ? (
                <div
                  key={row.level}
                  className={riskMeta(row.level).bar}
                  style={{ width: `${row.percentage}%` }}
                />
              ) : null,
            )}
          </div>
          <ul className="mt-4 space-y-3">
            {rows.map((row) => {
              const meta = riskMeta(row.level);
              return (
                <li key={row.level}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      <span className="font-medium text-ink-800">{meta.label}</span>
                      <span className="mono text-ink-500">{meta.range}</span>
                    </span>
                    <span className="tabular text-ink-600">
                      {formatNumber(row.count)}
                      <span className="ml-2 text-ink-400">{row.percentage.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <MeterBar value={row.percentage} max={100} className={meta.bar} height="h-1" />
                  </div>
                  <p className="mt-1 text-2xs text-ink-500">{meta.action}</p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export function LatencyPanel({ latency }) {
  if (!latency || !latency.sample_size) {
    return (
      <EmptyState
        icon="clock"
        title="No latency samples"
        description="Latency is recorded per transaction while the stream runs."
      />
    );
  }

  const rows = [
    ['Average', latency.average_ms],
    ['Median', latency.median_ms],
    ['p95', latency.p95_ms],
    ['p99', latency.p99_ms],
    ['Max', latency.max_ms],
  ];

  return (
    <div className="px-5 py-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow">Average inference</p>
          <p className={`tabular mt-1 text-[30px] font-semibold leading-none ${latencyTone(latency.average_ms, latency.target_ms)}`}>
            {formatMs(latency.average_ms)}
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-2xs font-semibold ${
            latency.within_target
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {latency.within_target ? 'Within budget' : 'Over budget'}
        </span>
      </div>

      <div className="mt-4 space-y-2.5">
        {rows.map(([label, value]) => (
          <div key={label}>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-ink-500">{label}</span>
              <span className={`tabular font-medium ${latencyTone(value, latency.target_ms)}`}>
                {formatMs(value)}
              </span>
            </div>
            <MeterBar
              value={Math.min(value || 0, latency.target_ms)}
              max={latency.target_ms}
              className="bg-ink-900/70"
              height="h-1"
            />
          </div>
        ))}
      </div>

      <p className="mt-4 text-2xs text-ink-500">
        Budget {formatMs(latency.target_ms, 0)} per transaction - {formatNumber(latency.sample_size)}{' '}
        samples in the rolling window.
      </p>
    </div>
  );
}

export function ConfusionMatrixGrid({ matrix, title = 'Confusion matrix' }) {
  if (!matrix) return null;
  const cells = [
    { label: 'True positive', hint: 'Fraud caught', value: matrix.true_positive, tone: 'text-emerald-600' },
    { label: 'False positive', hint: 'False alarm', value: matrix.false_positive, tone: 'text-amber-600' },
    { label: 'False negative', hint: 'Fraud missed', value: matrix.false_negative, tone: 'text-rose-600' },
    { label: 'True negative', hint: 'Correctly cleared', value: matrix.true_negative, tone: 'text-ink-900' },
  ];
  return (
    <div className="px-5 py-4">
      <p className="eyebrow">{title}</p>
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-hairline">
        {cells.map((cell) => (
          <div key={cell.label} className="bg-white px-4 py-3.5">
            <p className={`tabular text-[22px] font-semibold leading-none ${cell.tone}`}>
              {formatNumber(cell.value)}
            </p>
            <p className="mt-1.5 text-[12.5px] font-medium text-ink-700">{cell.label}</p>
            <p className="text-2xs text-ink-500">{cell.hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PrCurveChart({ curve }) {
  const data = (curve || []).map((point) => ({
    recall: Number(point.recall),
    Precision: Number(point.precision),
  }));

  if (data.length < 2) {
    return (
      <EmptyState
        icon="chart"
        title="Precision-recall curve unavailable"
        description="The curve is stored with the model metadata after training."
      />
    );
  }

  return (
    <div className="h-[240px] px-2 pb-3 pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 14, left: -16, bottom: 4 }}>
          <CartesianGrid stroke="#EDEFF3" />
          <XAxis
            dataKey="recall"
            type="number"
            domain={[0, 1]}
            {...AXIS}
            tickFormatter={(value) => value.toFixed(1)}
            label={{ value: 'Recall', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#9AA4B5' }}
          />
          <YAxis
            domain={[0, 1]}
            {...AXIS}
            width={44}
            tickFormatter={(value) => value.toFixed(1)}
          />
          <Tooltip content={<ChartTooltip />} />
          <Line type="monotone" dataKey="Precision" stroke="#E8582A" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HourlyDistributionChart({ hourly }) {
  const data = (hourly || []).map((point) => ({
    hour: `${String(point.hour).padStart(2, '0')}:00`,
    Transactions: point.transactions,
    Fraud: point.fraud,
  }));

  if (!data.length) return null;

  return (
    <div className="h-[230px] px-2 pb-3 pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#EDEFF3" vertical={false} />
          <XAxis dataKey="hour" {...AXIS} interval={2} />
          <YAxis {...AXIS} width={48} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="Transactions" fill="#C9CFDA" radius={[2, 2, 0, 0]} />
          <Bar dataKey="Fraud" fill="#E8582A" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AccountSignalBars({ signals }) {
  if (!signals) return null;
  const entries = Object.entries(signals);
  return (
    <ul className="space-y-2">
      {entries.map(([name, value]) => (
        <li key={name}>
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="text-ink-600">{titleCase(name)}</span>
            <span className="tabular font-medium text-ink-900">{formatScore(value, 2)}</span>
          </div>
          <MeterBar
            value={value}
            max={1}
            className={value >= 0.7 ? 'bg-rose-500' : value >= 0.4 ? 'bg-amber-500' : 'bg-emerald-500'}
            height="h-1"
          />
        </li>
      ))}
    </ul>
  );
}

export function CandidateComparison({ candidates, selected }) {
  if (!candidates || !candidates.length) return null;
  return (
    <div className="scroll-thin relative overflow-x-auto">
      <table className="w-full min-w-[680px]">
        <thead>
          <tr>
            <th className="th">Candidate</th>
            <th className="th text-right">PR-AUC</th>
            <th className="th text-right">ROC-AUC</th>
            <th className="th text-right">Precision</th>
            <th className="th text-right">Recall</th>
            <th className="th text-right">p95 latency</th>
            <th className="th text-right">Fit time</th>
          </tr>
        </thead>
        <tbody>
          {[...candidates]
            .sort(
              (left, right) =>
                (right.validation.pr_auc || 0) - (left.validation.pr_auc || 0),
            )
            .map((candidate) => {
              const isSelected = candidate.model_name === selected;
              return (
                <tr key={candidate.model_name} className={isSelected ? 'bg-brand-50/50' : ''}>
                  <td className="td">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-ink-900">
                        {titleCase(candidate.model_name)}
                      </span>
                      {isSelected ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-white px-2 py-0.5 text-2xs font-semibold text-brand-700">
                          <Icon name="check" className="h-3 w-3" />
                          serving
                        </span>
                      ) : null}
                    </span>
                    <span className="text-2xs text-ink-500">{candidate.estimator}</span>
                  </td>
                  <td className="td tabular text-right font-medium">
                    {formatScore(candidate.validation.pr_auc, 4)}
                  </td>
                  <td className="td tabular text-right">{formatScore(candidate.validation.roc_auc, 4)}</td>
                  <td className="td tabular text-right">{formatScore(candidate.validation.precision, 4)}</td>
                  <td className="td tabular text-right">{formatScore(candidate.validation.recall, 4)}</td>
                  <td className={`td tabular text-right ${latencyTone(candidate.latency.p95_ms)}`}>
                    {formatMs(candidate.latency.p95_ms)}
                  </td>
                  <td className="td tabular text-right text-ink-500">
                    {candidate.fit_seconds}s
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

export function RiskBandLegend() {
  return (
    <div className="grid gap-px overflow-hidden rounded-md border border-hairline bg-hairline sm:grid-cols-4">
      {RISK_ORDER.map((level) => {
        const meta = RISK_LEVELS[level];
        return (
          <div key={level} className="bg-white px-4 py-3">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-900">
              <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
            <p className="mono mt-1 text-ink-500">{meta.range}</p>
            <p className="mt-1 text-2xs text-ink-500">{meta.action}</p>
          </div>
        );
      })}
    </div>
  );
}

export { Card, CardHeader };
