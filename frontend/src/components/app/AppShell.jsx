import React, { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Icon, Logo } from '../Icons';
import { useAuth } from '../../context/AuthContext';
import { useStream } from '../../context/StreamContext';
import StreamControls from './StreamControls';
import { formatRelative } from '../../utils/format';

const NAV = [
  { to: '/app', label: 'Overview', icon: 'dashboard', exact: true },
  { to: '/app/monitor', label: 'Live monitor', icon: 'activity' },
  { to: '/app/alerts', label: 'Fraud alerts', icon: 'alert', badge: 'alerts' },
  { to: '/app/investigations', label: 'Investigations', icon: 'shield', badge: 'cases' },
  { to: '/app/accounts', label: 'High-risk accounts', icon: 'users' },
  { to: '/app/analytics', label: 'Model analytics', icon: 'chart' },
  { to: '/app/dataset', label: 'Dataset & stream', icon: 'database' },
];

/**
 * Shown whenever the dashboard is not talking to the detection engine.
 *
 * Nothing is substituted when a request fails: every figure in this console is
 * measured by the engine, and a fraud dashboard that invents numbers to stay
 * pretty is worse than one that admits it lost contact. Whatever is on screen
 * during an outage is the last real measurement, and this says so.
 */
function EngineBanner() {
  const { engineUnreachable, engineConnecting, engineError, lastEngineContactAt } = useStream();

  if (!engineUnreachable && !engineConnecting) return null;

  if (engineConnecting) {
    return (
      <div
        className="flex items-center gap-2.5 border-b border-sky-200 bg-sky-50 px-4 py-2 text-[13px] text-sky-900 sm:px-6"
        role="status"
      >
        <Icon name="activity" className="h-4 w-4 shrink-0 animate-pulse-dot" />
        <span>
          <span className="font-semibold">Connecting to the detection engine.</span>{' '}
          A sleeping instance can take up to a minute to answer its first request.
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-amber-300 bg-amber-50 px-4 py-2 text-[13px] text-amber-950 sm:px-6"
      role="alert"
    >
      <Icon name="alert" className="h-4 w-4 shrink-0" />
      <span>
        <span className="font-semibold">Detection engine unreachable.</span> Live
        updates have stopped. Any figures still on screen are the last ones the
        engine measured, not current readings.
      </span>
      {engineError ? (
        <span className="text-2xs text-amber-800">({engineError})</span>
      ) : null}
      {lastEngineContactAt ? (
        <span className="text-2xs text-amber-800">
          last reached {formatRelative(lastEngineContactAt)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Shown when the live stream was started by a different account.
 *
 * This engine runs one stream, in one process, with its counters in memory, so
 * whoever presses Start replaces what every other signed-in analyst is
 * watching. That is the intended shape - a fraud team works one queue - but
 * unannounced it reads as the dashboard rewriting itself, which is exactly how
 * an uploaded dataset appearing to "show for other users" gets reported as a
 * bug. Naming the account makes a shared workspace legible instead of spooky.
 */
function SharedStreamBanner() {
  const { streamStatus, isRunning } = useStream();
  const { user } = useAuth();

  const startedBy = streamStatus ? streamStatus.started_by : null;
  if (!isRunning || !startedBy) return null;
  // No id on the run means nobody pressed Start: the engine autostarted it on
  // boot, which is not somebody else's run and needs no announcement.
  if (!startedBy.id || !user || startedBy.id === user.id) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-sky-200 bg-sky-50 px-4 py-2 text-[13px] text-sky-900 sm:px-6"
      role="status"
    >
      <Icon name="users" className="h-4 w-4 shrink-0" />
      <span>
        <span className="font-semibold">
          Streaming {startedBy.email || 'another analyst'}&rsquo;s run
        </span>{' '}
        — this console shares one live stream, so these figures are the run they
        started
        {streamStatus.source_name ? (
          <>
            {' '}
            on <span className="mono">{streamStatus.source_name}</span>
          </>
        ) : null}
        , not a separate one of your own.
      </span>
    </div>
  );
}

function RealtimePill() {
  const { realtimeStatus, engineOnline, engineConnecting, lastUpdatedAt, error } = useStream();

  const state = engineConnecting
    ? { tone: 'bg-sky-500', label: 'Connecting' }
    : !engineOnline
    ? { tone: 'bg-rose-500', label: 'Engine offline' }
    : realtimeStatus === 'connected'
      ? { tone: 'bg-emerald-500', label: 'Realtime live' }
      : realtimeStatus === 'disabled'
        ? { tone: 'bg-amber-500', label: 'Polling only' }
        : realtimeStatus === 'error'
          ? { tone: 'bg-amber-500', label: 'Realtime retrying' }
          : { tone: 'bg-sky-500', label: 'Connecting' };

  return (
    <div
      className="hidden items-center gap-2 rounded-md border border-hairline bg-white px-2.5 py-1.5 md:flex"
      title={error || undefined}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${state.tone} ${engineOnline ? 'animate-pulse-dot' : ''}`} />
      <span className="text-[12.5px] font-medium text-ink-700">{state.label}</span>
      {lastUpdatedAt ? (
        <span className="border-l border-hairline pl-2 text-2xs text-ink-500">
          {formatRelative(lastUpdatedAt)}
        </span>
      ) : null}
    </div>
  );
}

function Sidebar({ open, onClose }) {
  const { alerts, investigations } = useStream();
  const { displayName, email, role, signOut, isDemoSession } = useAuth();
  const openAlerts = alerts.filter((alert) => alert.status === 'open').length;
  const activeCases = investigations.filter(
    (item) => item.status === 'open' || item.status === 'investigating',
  ).length;

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-ink-950/40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={`dark-surface fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col bg-ink-900 transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Sections"
      >
        <div className="flex h-[64px] items-center justify-between gap-2 border-b border-white/8 px-4">
          <Link to="/" className="flex items-center gap-2.5" aria-label="FraudStream AI home">
            <Logo className="h-7 w-7" />
            <span className="text-[15.5px] font-semibold tracking-tightest text-white">
              FraudStream<span className="text-brand-400">.</span>
            </span>
          </Link>
          <button
            type="button"
            className="rounded p-1.5 text-white/60 hover:text-white lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              exact={item.exact}
              onClick={onClose}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] font-medium text-white/65 transition-colors hover:bg-white/[0.06] hover:text-white"
              activeClassName="bg-brand-500/12 text-white ring-1 ring-inset ring-brand-500/30"
            >
              <Icon name={item.icon} className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
              {item.badge === 'alerts' && openAlerts > 0 ? (
                <span className="tabular rounded-full bg-brand-500 px-1.5 py-0.5 text-2xs font-semibold text-white">
                  {openAlerts > 99 ? '99+' : openAlerts}
                </span>
              ) : null}
              {item.badge === 'cases' && activeCases > 0 ? (
                <span className="tabular rounded-full bg-amber-400 px-1.5 py-0.5 text-2xs font-semibold text-ink-950">
                  {activeCases > 99 ? '99+' : activeCases}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/8 p-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[12.5px] font-semibold text-white">Runbook</p>
            <p className="mt-1 text-[12px] leading-relaxed text-white/55">
              Start the stream from the top bar, then follow alerts as they arrive.
            </p>
            <Link
              to="/app/dataset"
              className="mt-2.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-300 hover:text-brand-200"
            >
              Stream settings
              <Icon name="arrowRight" className="h-3 w-3" />
            </Link>
          </div>

          <div className="mt-3 flex items-center gap-2.5 px-1">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-[12.5px] font-semibold uppercase text-brand-300">
              {(displayName || 'A').slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-white">{displayName}</p>
              <p className="truncate text-2xs text-white/50">
                {isDemoSession ? 'demo session' : email || role}
              </p>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="rounded p-1.5 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Sign out"
              title="Sign out"
            >
              <Icon name="logout" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tightest text-ink-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13.5px] text-ink-500">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export default function AppShell({ children }) {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const { isRunning, streamStatus } = useStream();

  const current = NAV.find((item) =>
    item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to),
  );

  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[64px] items-center gap-3 border-b border-hairline bg-white/95 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            className="btn-ghost btn-sm lg:hidden"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
          >
            <Icon name="menu" className="h-5 w-5" />
          </button>

          <nav className="hidden items-center gap-2 text-[13px] text-ink-500 sm:flex" aria-label="Breadcrumb">
            <span>Detection</span>
            <Icon name="chevronRight" className="h-3 w-3" />
            <span className="font-medium text-ink-900">{current ? current.label : 'Overview'}</span>
          </nav>

          <div className="flex-1" />

          <span className="sr-only" aria-live="polite">
            {isRunning
              ? `Stream running, ${streamStatus ? streamStatus.processed : 0} transactions processed`
              : 'Stream idle'}
          </span>

          <RealtimePill />
          <StreamControls />
        </header>

        <EngineBanner />
        <SharedStreamBanner />

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
