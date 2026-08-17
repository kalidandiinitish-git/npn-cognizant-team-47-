import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, Logo, Wordmark } from '../Icons';

const NAV_LINKS = [
  { label: 'Platform', href: '#platform' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Performance', href: '#performance' },
  { label: 'Risk model', href: '#risk-model' },
];

export function TopStrip() {
  return (
    <div className="bg-ink-900 text-white">
      <div className="container-page flex h-10 items-center justify-center gap-3 text-[12.5px]">
        <span className="hidden font-medium sm:inline">
          Generator-based pseudo-streaming detection, built on the ULB card fraud dataset
        </span>
        <span className="sm:hidden font-medium">Real-time card fraud detection</span>
        <a
          href="#performance"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-brand-300 hover:text-brand-200"
        >
          See the measured numbers
          <Icon name="arrowRight" className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 bg-white/95 backdrop-blur transition-shadow ${
        scrolled ? 'border-b border-hairline shadow-[0_1px_0_rgba(11,18,32,0.04)]' : 'border-b border-transparent'
      }`}
    >
      <div className="container-page flex h-[68px] items-center justify-between gap-6">
        <Link to="/" className="rounded" aria-label="FraudStream AI home">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded px-3 py-2 text-[14px] font-medium text-ink-700 transition-colors hover:text-ink-900"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link to="/login" className="btn-ghost btn-sm">
            Sign in
          </Link>
          <Link to="/app" className="btn-primary btn-sm">
            Open dashboard
          </Link>
        </div>

        <button
          type="button"
          className="btn-ghost btn-sm lg:hidden"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls="mobile-nav"
        >
          <Icon name={open ? 'close' : 'menu'} className="h-5 w-5" />
          <span className="sr-only">Toggle navigation</span>
        </button>
      </div>

      {open ? (
        <div id="mobile-nav" className="border-t border-hairline bg-white lg:hidden">
          <nav className="container-page flex flex-col py-3" aria-label="Mobile">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded px-1 py-2.5 text-[15px] font-medium text-ink-700"
              >
                {link.label}
              </a>
            ))}
            <div className="mt-2 flex gap-3 border-t border-hairline pt-3">
              <Link to="/login" className="btn-outline btn-sm flex-1">
                Sign in
              </Link>
              <Link to="/app" className="btn-primary btn-sm flex-1">
                Open dashboard
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}

export function SiteFooter() {
  const columns = [
    {
      title: 'Platform',
      links: [
        { label: 'Live monitoring', href: '#platform' },
        { label: 'Risk engine', href: '#risk-model' },
        { label: 'Model analytics', href: '#performance' },
        { label: 'Pseudo-streaming', href: '#how-it-works' },
      ],
    },
    {
      title: 'Engineering',
      links: [
        { label: 'Architecture', href: '#how-it-works' },
        { label: 'API surface', href: '#platform' },
        { label: 'Database schema', href: '#risk-model' },
        { label: 'Latency budget', href: '#performance' },
      ],
    },
    {
      title: 'Access',
      links: [
        { label: 'Sign in', to: '/login' },
        { label: 'Dashboard', to: '/app' },
        { label: 'Live monitor', to: '/app/monitor' },
        { label: 'Fraud alerts', to: '/app/alerts' },
      ],
    },
  ];

  return (
    <footer className="dark-surface bg-ink-900 text-white">
      <div className="container-page grid grid-cols-1 gap-10 py-14 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[17px] font-semibold tracking-tightest text-white">
              FraudStream<span className="text-brand-400">.</span>
            </span>
          </div>
          <p className="mt-3 max-w-xs text-[13.5px] leading-relaxed text-white/60">
            A real-time card fraud detection stack: Python generator streaming, sub-50 ms scoring,
            account-level risk aggregation and a live analyst dashboard.
          </p>
        </div>

        {columns.map((column) => (
          <div key={column.title}>
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-white/45">
              {column.title}
            </p>
            <ul className="mt-3.5 space-y-2.5">
              {column.links.map((link) => (
                <li key={link.label}>
                  {link.to ? (
                    <Link to={link.to} className="text-[13.5px] text-white/75 hover:text-white">
                      {link.label}
                    </Link>
                  ) : (
                    <a href={link.href} className="text-[13.5px] text-white/75 hover:text-white">
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-2 py-5 text-[12.5px] text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <p>FraudStream AI - Team 47. Built for the real-time fraud detection brief.</p>
          <p>
            Model and metrics measured on the ULB credit card fraud dataset. No production
            cardholder data is used.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default SiteHeader;
