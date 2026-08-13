import React from 'react';
import { Icon } from './Icons';
import { riskMeta } from '../utils/risk';

export function Card({ children, className = '', as: Tag = 'section', ...rest }) {
  return (
    <Tag className={`card ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, subtitle, action, icon }) {
  return (
    <header className="card-header">
      <div className="flex items-start gap-3">
        {icon ? (
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-hairline bg-paper text-ink-600">
            <Icon name={icon} className="h-3.5 w-3.5" />
          </span>
        ) : null}
        <div>
          <h2 className="card-title">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[13px] text-ink-500">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function Badge({ children, className = '', dot }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-2xs font-semibold ${className}`}
    >
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${dot}`} /> : null}
      {children}
    </span>
  );
}

export function RiskBadge({ level, showRange = false }) {
  const meta = riskMeta(level);
  return (
    <Badge className={meta.badge} dot={meta.dot}>
      {meta.label}
      {showRange ? <span className="font-normal opacity-70">{meta.range}</span> : null}
    </Badge>
  );
}

export function StatTile({
  label,
  value,
  unit,
  hint,
  delta,
  deltaTone = 'neutral',
  icon,
  tone = 'default',
  children,
}) {
  const toneRing = {
    default: 'border-hairline',
    alert: 'border-brand-200',
    critical: 'border-rose-200',
  }[tone];

  const deltaStyles = {
    up: 'text-rose-600',
    down: 'text-emerald-600',
    neutral: 'text-ink-500',
  }[deltaTone];

  return (
    <div className={`rounded-lg border bg-white p-4 shadow-card ${toneRing}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow">{label}</p>
        {icon ? (
          <span className="text-ink-400">
            <Icon name={icon} className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span className="tabular text-[26px] font-semibold leading-none tracking-tightest text-ink-900">
          {value}
        </span>
        {unit ? <span className="text-[13px] font-medium text-ink-500">{unit}</span> : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {hint ? <p className="text-[12.5px] text-ink-500">{hint}</p> : <span />}
        {delta ? (
          <span className={`inline-flex items-center gap-1 text-[12.5px] font-medium ${deltaStyles}`}>
            {deltaTone !== 'neutral' ? (
              <Icon name={deltaTone === 'up' ? 'trendUp' : 'trendDown'} className="h-3.5 w-3.5" />
            ) : null}
            {delta}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function Bar({ value, max = 1, className = 'bg-brand-500', height = 'h-1.5' }) {
  const percentage = Math.max(0, Math.min(100, (Number(value) / (max || 1)) * 100));
  return (
    <div className={`w-full overflow-hidden rounded-full bg-ink-900/[0.07] ${height}`}>
      <div className={`${height} rounded-full ${className}`} style={{ width: `${percentage}%` }} />
    </div>
  );
}

export function Sparkline({ points = [], className = 'text-brand-500', height = 34 }) {
  if (!points.length) {
    return <div className="h-[34px]" />;
  }
  const values = points.map((point) => Number(point) || 0);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const width = 100;
  const step = values.length > 1 ? width / (values.length - 1) : width;

  const path = values
    .map((value, index) => {
      const x = (index * step).toFixed(2);
      const y = (height - ((value - min) / span) * (height - 4) - 2).toFixed(2);
      return `${index === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`h-[34px] w-full ${className}`}
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function EmptyState({ icon = 'info', title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-hairline bg-paper text-ink-500">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <p className="mt-3 text-[15px] font-semibold text-ink-900">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-md text-[13.5px] leading-relaxed text-ink-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.2" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Banner({ tone = 'info', title, children, action, onDismiss }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-rose-200 bg-rose-50 text-rose-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  const icons = { info: 'info', warn: 'alert', error: 'alert', success: 'check' };
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${tones[tone]}`} role="status">
      <Icon name={icons[tone]} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div> : null}
      </div>
      {action}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded p-1 opacity-60 transition-opacity hover:opacity-100"
          aria-label="Dismiss message"
        >
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function Tabs({ items, value, onChange, ariaLabel = 'Filter' }) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-md border border-hairline bg-white p-1"
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={`rounded px-2.5 py-1 text-[13px] font-medium transition-colors ${
              active ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-900/[0.05]'
            }`}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className={`ml-1.5 tabular ${active ? 'opacity-80' : 'text-ink-400'}`}>
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }) {
  return <div className={`animate-pulse rounded bg-ink-900/[0.06] ${className}`} />;
}

export function TableShell({ children, className = '' }) {
  return (
    <div className={`scroll-thin overflow-x-auto ${className}`}>
      <table className="w-full min-w-[720px]">{children}</table>
    </div>
  );
}

export function DefinitionRow({ label, children, mono = false }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-hairline/70 py-2.5 last:border-0">
      <dt className="text-[13px] text-ink-500">{label}</dt>
      <dd className={`text-right text-[13px] font-medium text-ink-900 ${mono ? 'mono' : 'tabular'}`}>
        {children}
      </dd>
    </div>
  );
}
