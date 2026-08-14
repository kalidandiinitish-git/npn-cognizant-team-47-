import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../Icons';
import HeroPreview from './HeroPreview';
import { GENERATOR_SNIPPET, HEADLINE_STATS, MODEL_FACTS, PIPELINE_STAGES } from '../../data/modelFacts';
import { RISK_LEVELS, RISK_ORDER } from '../../utils/risk';
import { formatNumber } from '../../utils/format';

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-16 pt-14 sm:pt-20">
      <div className="container-page">
        <div className="mx-auto max-w-3xl text-center">
          <p className="eyebrow">Payment fraud detection</p>
          <h1 className="mt-4 text-[40px] font-bold leading-[1.06] tracking-tightest text-ink-900 sm:text-[56px]">
            Catch card fraud in the
            <br className="hidden sm:block" /> first <span className="text-brand-500">50 milliseconds</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[16.5px] leading-relaxed text-ink-600">
            FraudStream scores every transaction the moment it arrives, one at a time, through a
            Python generator instead of a nightly batch. Risky transactions are flagged, repeat
            offenders roll up into account-level risk, and your analysts see it happen live.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to="/app" className="btn-primary w-full sm:w-auto">
              Open the dashboard
              <Icon name="arrowRight" className="h-4 w-4" />
            </Link>
            <a href="#how-it-works" className="btn-outline w-full sm:w-auto">
              See how it works
            </a>
          </div>
          <p className="mt-4 text-[12.5px] text-ink-500">
            Runs on the public ULB dataset - {formatNumber(MODEL_FACTS.dataset.cleanRows)} transactions,{' '}
            {MODEL_FACTS.dataset.fraudRows} confirmed frauds.
          </p>
        </div>

        <div className="mt-12">
          <HeroPreview />
        </div>
      </div>
    </section>
  );
}

export function StackStrip() {
  const stack = ['scikit-learn', 'XGBoost', 'FastAPI', 'Supabase', 'React 16', 'Recharts'];
  return (
    <section className="hairline-t hairline-b bg-white py-8">
      <div className="container-page">
        <p className="text-center text-2xs font-semibold uppercase tracking-[0.16em] text-ink-500">
          Built with a production-shaped stack
        </p>
        <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {stack.map((item) => (
            <li
              key={item}
              className="text-[15px] font-semibold tracking-tight text-ink-500/85"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: 'stream',
    title: 'Stop batch blind spots',
    body:
      'Transactions are consumed from a generator and scored individually, so a fraudulent card is caught on arrival instead of in tomorrow morning\u2019s job.',
  },
  {
    icon: 'bolt',
    title: 'Keep checkout fast',
    body:
      'The whole path, feature transform through inference, averages under a millisecond, which leaves the rest of the 50 ms budget to your payment flow.',
  },
  {
    icon: 'users',
    title: 'Catch repeat offenders',
    body:
      'Seven behavioural signals, velocity, amount deviation, geography and merchant anomaly, roll individual hits into an account risk score.',
  },
  {
    icon: 'target',
    title: 'Control false positives',
    body:
      'The decision threshold is tuned on a precision-recall curve rather than left at 0.5, so recall goes up without burying the queue in false alarms.',
  },
];

export function FeatureGrid() {
  return (
    <section id="platform" className="bg-paper py-20">
      <div className="container-page">
        <div className="max-w-2xl">
          <p className="eyebrow">The problem</p>
          <h2 className="mt-3 text-[32px] font-bold leading-tight tracking-tightest sm:text-[38px]">
            Fraud arrives one transaction at a time.
            <span className="text-brand-500"> Detection should too.</span>
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-600">
            Fewer than two in a thousand transactions in this dataset are fraudulent. A model that
            optimises accuracy will happily miss all of them. FraudStream is built around that
            imbalance from the first line of the pipeline.
          </p>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="bg-white p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-md border border-hairline bg-paper text-brand-500">
                <Icon name={feature.icon} className="h-4 w-4" />
              </span>
              <h3 className="mt-4 text-[15.5px] font-semibold">{feature.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-600">{feature.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: 'Train on history, chronologically',
    body:
      'The dataset is de-duplicated, cleaned and split by time, never shuffled, so the model is never tested on transactions that happened before the ones it learned from.',
  },
  {
    title: 'Compare four detectors honestly',
    body:
      'Logistic regression, random forest, XGBoost and isolation forest are scored on PR-AUC, recall and single-transaction latency. Latency is a gate, not a tiebreak: the best PR-AUC among the models fast enough to hold the budget wins.',
  },
  {
    title: 'Stream the held-out split',
    body:
      'A Python generator replays the untouched test transactions as an event stream. One record is parsed and scored before the next is read; writes are batched onto a separate thread so storage latency never counts against the scoring budget.',
  },
  {
    title: 'Aggregate, alert, display',
    body:
      'Each score maps to a risk band and updates the account profile. Anything at 0.70 or above raises an alert, lands in Postgres and reaches the dashboard over Supabase Realtime.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-white py-20">
      <div className="container-page">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
          <div>
            <p className="eyebrow">How it works</p>
            <h2 className="mt-3 text-[32px] font-bold leading-tight tracking-tightest sm:text-[38px]">
              A pipeline you can read end to end
            </h2>
            <p className="mt-4 text-[15.5px] leading-relaxed text-ink-600">
              No hidden magic. Four stages, each one measurable, each one covered by tests.
            </p>

            <ol className="mt-8 space-y-6">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="mono mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ink-900/12 bg-paper text-ink-700">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-[15.5px] font-semibold">{step.title}</h3>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-600">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <div className="overflow-hidden rounded-lg border border-ink-800 bg-ink-900 shadow-panel">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                <span className="mono text-white/55">ml-engine/src/streaming/generator.py</span>
                <span className="rounded border border-brand-400/30 bg-brand-500/10 px-2 py-0.5 text-2xs font-semibold uppercase tracking-[0.1em] text-brand-300">
                  FR-008
                </span>
              </div>
              <pre className="scroll-thin overflow-x-auto px-4 py-4 text-[12.5px] leading-[1.65] text-white/85">
                <code className="font-mono">{GENERATOR_SNIPPET}</code>
              </pre>
            </div>

            <div className="mt-4 rounded-lg border border-hairline bg-paper p-4">
              <p className="text-[13px] leading-relaxed text-ink-600">
                <span className="font-semibold text-ink-900">Why a generator matters.</span> A
                DataFrame would hold the whole test set in memory and score it in one shot, which is
                a batch job wearing a real-time costume. Yielding one event keeps memory flat,
                makes latency measurable per transaction, and means the stream can be stopped
                mid-file without losing state.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-16">
          <p className="eyebrow">Data flow</p>
          <ol className="mt-4 flex flex-wrap items-center gap-2">
            {PIPELINE_STAGES.map((stage, index) => (
              <li key={stage.name} className="flex items-center gap-2">
                <span
                  className={`rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium ${
                    stage.kind === 'stream'
                      ? 'border-brand-200 bg-brand-50 text-brand-700'
                      : stage.kind === 'store'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : stage.kind === 'ui'
                          ? 'border-ink-900/15 bg-ink-900 text-white'
                          : 'border-hairline bg-white text-ink-700'
                  }`}
                >
                  {stage.name}
                </span>
                {index < PIPELINE_STAGES.length - 1 ? (
                  <Icon name="chevronRight" className="h-3.5 w-3.5 text-ink-400" />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function PerformanceBand() {
  const { test, dataset, latency } = MODEL_FACTS;
  return (
    <section id="performance" className="dark-surface bg-ink-900 py-20 text-white">
      <div className="container-page">
        <div className="max-w-2xl">
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-brand-300">
            Measured, not estimated
          </p>
          <h2 className="mt-3 text-[32px] font-bold leading-tight tracking-tightest text-white sm:text-[38px]">
            Numbers from the last training run
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-white/65">
            Evaluated on {formatNumber(dataset.testRows)} held-out transactions the model never saw,
            drawn from the end of the timeline. Latency is measured per transaction through the same
            code path the API serves.
          </p>
        </div>

        <dl className="mt-12 grid gap-px overflow-hidden rounded-lg bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
          {HEADLINE_STATS.map((stat) => (
            <div key={stat.label} className="bg-ink-900 p-6">
              <dd className="tabular text-[34px] font-semibold leading-none tracking-tightest text-white">
                {stat.value}
              </dd>
              <dt className="mt-2.5 text-[13.5px] font-semibold text-white/85">{stat.label}</dt>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/50">{stat.detail}</p>
            </div>
          ))}
        </dl>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-lg border border-white/12 p-5">
            <p className="text-[13px] font-semibold text-white/85">Confusion matrix, test split</p>
            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-white/10 text-center">
              {[
                { label: 'Caught fraud', value: test.truePositive, tone: 'text-emerald-300' },
                { label: 'False alarms', value: test.falsePositive, tone: 'text-amber-300' },
                { label: 'Missed fraud', value: test.falseNegative, tone: 'text-rose-300' },
                { label: 'Correctly cleared', value: formatNumber(test.trueNegative), tone: 'text-white' },
              ].map((cell) => (
                <div key={cell.label} className="bg-ink-900 px-4 py-4">
                  <p className={`tabular text-[24px] font-semibold leading-none ${cell.tone}`}>
                    {cell.value}
                  </p>
                  <p className="mt-1.5 text-2xs uppercase tracking-[0.1em] text-white/50">
                    {cell.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/12 p-5">
            <p className="text-[13px] font-semibold text-white/85">Where the budget goes</p>
            <div className="mt-4 space-y-4">
              {[
                { label: 'Average', value: latency.averageMs },
                { label: 'p95', value: latency.p95Ms },
                { label: 'p99', value: latency.p99Ms },
              ].map((row) => (
                <div key={row.label}>
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="text-white/60">{row.label}</span>
                    <span className="tabular font-medium text-white">{row.value} ms</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-1.5 rounded-full bg-brand-400"
                      style={{ width: `${Math.max((row.value / latency.targetMs) * 100, 1.5)}%` }}
                    />
                  </div>
                </div>
              ))}
              <p className="text-[12.5px] text-white/50">
                Full bar width is the {latency.targetMs} ms target from the requirements.
              </p>
            </div>
          </div>
        </div>

        <p className="mt-8 text-[12.5px] text-white/45">
          Class imbalance: {dataset.fraudRows} frauds in {formatNumber(dataset.cleanRows)}{' '}
          transactions, roughly one in {Math.round(dataset.imbalanceRatio)}. Accuracy is a useless
          metric here, which is why precision, recall and PR-AUC are reported instead.
        </p>
      </div>
    </section>
  );
}

export function RiskModel() {
  return (
    <section id="risk-model" className="bg-paper py-20">
      <div className="container-page grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
        <div>
          <p className="eyebrow">Risk model</p>
          <h2 className="mt-3 text-[32px] font-bold leading-tight tracking-tightest sm:text-[38px]">
            Four bands, four clear actions
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-ink-600">
            Raw model probability is rescaled so the tuned decision threshold lands exactly at the
            start of the high band. Analysts read one number and know what to do with it, and the
            mapping stays monotonic so nothing is reordered.
          </p>

          <div className="mt-8 rounded-lg border border-hairline bg-white p-5">
            <p className="text-[13px] font-semibold text-ink-900">Account escalation signals</p>
            <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {[
                'Suspicious transaction ratio',
                'Average and peak risk',
                'Transaction velocity',
                'High-value concentration',
                'Geographic spread',
                'Repeated merchant anomaly',
              ].map((signal) => (
                <li key={signal} className="flex items-start gap-2 text-[13px] text-ink-600">
                  <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
                  {signal}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-hairline bg-white">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Band</th>
                <th className="th">Risk score</th>
                <th className="th">Action</th>
              </tr>
            </thead>
            <tbody>
              {RISK_ORDER.map((level) => {
                const meta = RISK_LEVELS[level];
                return (
                  <tr key={level}>
                    <td className="td">
                      <span className="flex items-center gap-2 font-medium">
                        <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="td mono">{meta.range}</td>
                    <td className="td">{meta.action}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-hairline bg-paper px-4 py-3.5">
            <p className="text-[12.5px] leading-relaxed text-ink-600">
              <span className="font-semibold text-ink-900">Threshold {MODEL_FACTS.threshold}.</span>{' '}
              Chosen by maximising F2 across the precision-recall curve while holding precision at
              or above 0.50, so recall is favoured without flooding the review queue.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CtaBand() {
  return (
    <section className="bg-white py-20">
      <div className="container-page">
        <div className="overflow-hidden rounded-xl border border-hairline bg-paper">
          <div className="grid items-center gap-8 p-8 sm:p-12 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <h2 className="text-[28px] font-bold leading-tight tracking-tightest sm:text-[34px]">
                Start the stream and watch it work
              </h2>
              <p className="mt-3 max-w-xl text-[15.5px] leading-relaxed text-ink-600">
                Sign in, press start, and the held-out transactions begin arriving one by one with a
                score, a risk band and a latency reading on every row.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
              <Link to="/login" className="btn-outline">
                Sign in
              </Link>
              <Link to="/app" className="btn-primary">
                Open dashboard
                <Icon name="arrowRight" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
