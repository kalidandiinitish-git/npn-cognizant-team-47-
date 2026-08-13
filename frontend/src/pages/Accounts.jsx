import React, { useMemo, useState } from 'react';
import { PageHeader } from '../components/app/AppShell';
import { Card, CardHeader, StatTile, Tabs } from '../components/ui';
import { Icon } from '../components/Icons';
import { AccountTable } from '../components/app/tables';
import { useStream } from '../context/StreamContext';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { ACCOUNT_LEVEL_OPTIONS } from '../utils/constants';
import { formatNumber, formatScore } from '../utils/format';

export default function Accounts() {
  useDocumentTitle('High-risk accounts');
  const { accounts, totals, metrics } = useStream();

  const [level, setLevel] = useState('all');
  const [query, setQuery] = useState('');

  const levelCounts = (metrics && metrics.account_risk_levels) || {};

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return accounts.filter((account) => {
      if (level !== 'all' && account.risk_level !== level) return false;
      if (!needle) return true;
      return String(account.account_id).toLowerCase().includes(needle);
    });
  }, [accounts, level, query]);

  const worst = accounts.length ? accounts[0] : null;

  return (
    <>
      <PageHeader
        title="High-risk accounts"
        subtitle="Transaction-level scores aggregated into account behaviour, weighted across seven signals."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Monitored accounts"
          value={formatNumber(totals ? totals.monitored_accounts : 0)}
          icon="users"
        />
        <StatTile
          label="High risk"
          value={formatNumber(levelCounts.high || 0)}
          hint="risk 0.70 - 0.89"
          icon="alert"
        />
        <StatTile
          label="Critical risk"
          value={formatNumber(levelCounts.critical || 0)}
          hint="risk 0.90 and above"
          icon="shield"
          tone={levelCounts.critical ? 'critical' : 'default'}
        />
        <StatTile
          label="Worst account"
          value={worst ? formatScore(worst.risk_score, 2) : '--'}
          hint={worst ? worst.account_id : 'nothing escalated yet'}
          icon="target"
        />
      </div>

      <div className="mt-4">
        <Card>
          <div className="flex flex-col gap-3 border-b border-hairline px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <Tabs
              ariaLabel="Filter by account risk level"
              value={level}
              onChange={setLevel}
              items={ACCOUNT_LEVEL_OPTIONS}
            />
            <div className="relative w-full lg:w-[260px]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
                <Icon name="search" className="h-4 w-4" />
              </span>
              <label className="sr-only" htmlFor="account-search">
                Search accounts
              </label>
              <input
                id="account-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search account id"
                className="field-input py-2 pl-9 text-[13.5px]"
              />
            </div>
          </div>

          <AccountTable accounts={filtered} />

          <div className="border-t border-hairline px-5 py-3 text-[12.5px] text-ink-500">
            An account never scores below 0.70 once it produces a suspicious transaction, so a long
            clean history cannot dilute a confirmed hit.
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader
            title="How account risk is calculated"
            subtitle="Weighted combination, normalised to 0-1"
            icon="help"
          />
          <div className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Average risk', '0.30', 'Mean transaction risk across the account'],
              ['Suspicious ratio', '0.20', 'Share of transactions that were flagged'],
              ['Maximum risk', '0.15', 'The single worst transaction seen'],
              ['Velocity', '0.10', 'Events inside a one hour window'],
              ['High value ratio', '0.10', 'Share of transactions above 500'],
              ['Geographic spread', '0.08', 'Distinct recent locations'],
              ['Merchant anomaly', '0.07', 'Repeated flags in one category'],
            ].map(([name, weight, description]) => (
              <div key={name} className="bg-white px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[13px] font-semibold text-ink-900">{name}</p>
                  <span className="mono text-brand-600">{weight}</span>
                </div>
                <p className="mt-1 text-2xs leading-relaxed text-ink-500">{description}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
