import React, { useEffect, useState } from 'react';
import { Icon } from '../Icons';
import { riskMeta } from '../../utils/risk';

/**
 * A preview of the live monitor for the landing page. The rows are a fixed
 * sample from the held-out test split, cycled on a timer, and the panel is
 * labelled as a preview - it is not connected to the engine.
 */
const SAMPLE_ROWS = [
  { ref: 'TXN-0241188', account: 'ACC-00184', amount: 41.2, merchant: 'FreshMart', score: 0.061, level: 'low', latency: 0.84 },
  { ref: 'TXN-0241189', account: 'ACC-00097', amount: 128.5, merchant: 'PixelHub', score: 0.187, level: 'low', latency: 0.91 },
  { ref: 'TXN-0241190', account: 'ACC-00312', amount: 942.0, merchant: 'CoinGate X', score: 0.884, level: 'high', latency: 1.12 },
  { ref: 'TXN-0241191', account: 'ACC-00312', amount: 1180.4, merchant: 'LedgerPeak', score: 0.973, level: 'critical', latency: 1.04 },
  { ref: 'TXN-0241192', account: 'ACC-00051', amount: 16.99, merchant: 'StreamNest', score: 0.043, level: 'low', latency: 0.79 },
  { ref: 'TXN-0241193', account: 'ACC-00229', amount: 305.75, merchant: 'SkyRoute Air', score: 0.512, level: 'medium', latency: 0.96 },
];

export default function HeroPreview() {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return undefined;
    const id = setInterval(() => setOffset((current) => (current + 1) % SAMPLE_ROWS.length), 2600);
    return () => clearInterval(id);
  }, []);

  const rows = SAMPLE_ROWS.map((_, index) => SAMPLE_ROWS[(offset + index) % SAMPLE_ROWS.length]);
  const flagged = rows.filter((row) => row.level === 'high' || row.level === 'critical');

  return (
    <figure className="relative mx-auto w-full max-w-[1020px]">
      <div className="overflow-hidden rounded-xl border border-hairline bg-white shadow-panel">
        {/* window chrome */}
        <div className="flex items-center gap-3 border-b border-hairline bg-paper px-4 py-2.5">
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-ink-900/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink-900/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink-900/15" />
          </div>
          <div className="mono flex-1 truncate rounded border border-hairline bg-white px-2.5 py-1 text-ink-500">
            fraudstream.app/app/monitor
          </div>
          <span className="hidden items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-ink-500 sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-emerald-500" />
            streaming
          </span>
        </div>

        <div className="grid gap-0 md:grid-cols-[1.55fr_1fr]">
          {/* live feed */}
          <div className="border-b border-hairline md:border-b-0 md:border-r">
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-[13px] font-semibold text-ink-900">Live transaction feed</p>
              <span className="mono text-ink-500">one event at a time</span>
            </div>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[440px]">
                <thead>
                  <tr>
                    <th className="th">Transaction</th>
                    <th className="th">Amount</th>
                    <th className="th">Risk</th>
                    <th className="th text-right">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const meta = riskMeta(row.level);
                    return (
                      <tr
                        key={`${row.ref}-${index}`}
                        className={index === 0 ? 'animate-fade-in-row bg-brand-50/40' : ''}
                      >
                        <td className="td">
                          <span className="mono block text-ink-900">{row.ref}</span>
                          <span className="text-2xs text-ink-500">
                            {row.account} - {row.merchant}
                          </span>
                        </td>
                        <td className="td tabular">${row.amount.toFixed(2)}</td>
                        <td className="td">
                          <span className="flex items-center gap-2">
                            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                            <span className="tabular font-medium">{row.score.toFixed(3)}</span>
                            <span className="text-2xs uppercase tracking-wide text-ink-500">
                              {meta.label}
                            </span>
                          </span>
                        </td>
                        <td className="td tabular text-right text-emerald-600">
                          {row.latency.toFixed(2)} ms
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* side panel */}
          <div className="divide-y divide-hairline">
            <div className="px-4 py-3.5">
              <p className="eyebrow">Account under review</p>
              <p className="mono mt-1.5 text-[15px] font-medium text-ink-900">ACC-00312</p>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="tabular text-[30px] font-semibold leading-none text-rose-600">
                  0.94
                </span>
                <span className="text-[13px] font-medium text-ink-500">account risk</span>
              </div>
              <div className="mt-3 space-y-2">
                {[
                  ['Suspicious transactions', '4 of 6'],
                  ['Velocity, last hour', '6 events'],
                  ['Merchant anomaly', 'Crypto Exchange x3'],
                  ['Geo mismatch', '3 cities'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="text-ink-500">{label}</span>
                    <span className="tabular font-medium text-ink-900">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 divide-x divide-hairline">
              <div className="px-4 py-3">
                <p className="eyebrow">Flagged now</p>
                <p className="tabular mt-1 text-[20px] font-semibold text-ink-900">
                  {flagged.length}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="eyebrow">Avg latency</p>
                <p className="tabular mt-1 text-[20px] font-semibold text-ink-900">0.97 ms</p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 bg-paper px-4 py-3">
              <span className="mt-0.5 text-brand-500">
                <Icon name="alert" className="h-4 w-4" />
              </span>
              <p className="text-[12.5px] leading-relaxed text-ink-600">
                <span className="font-semibold text-ink-900">Critical alert raised.</span> Fourth
                high-risk transaction on ACC-00312 within the hour. Account escalated for
                investigation.
              </p>
            </div>
          </div>
        </div>
      </div>

      <figcaption className="mt-3 text-center text-2xs uppercase tracking-[0.14em] text-ink-500">
        Preview of the live monitor - sample rows from the held-out test split
      </figcaption>
    </figure>
  );
}
