import React from 'react';

/**
 * Hand-rolled 24x24 stroke icons. Keeping them inline avoids an icon-font
 * dependency and keeps the visual language consistent.
 */
const PATHS = {
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  activity: 'M3 12h3.5l2.5-7 4 14 2.6-7H21',
  alert: 'M12 4 3 19h18L12 4zM12 10v4M12 16.5v.5',
  users: 'M16 19v-1.5A3.5 3.5 0 0 0 12.5 14h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 19v-1.4c0-1.5-1-2.8-2.5-3.2M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  chart: 'M4 20V9M10 20V4M16 20v-7M22 20H2',
  database: 'M12 7c4.4 0 8-1.1 8-2.5S16.4 2 12 2 4 3.1 4 4.5 7.6 7 12 7ZM4 4.5v15C4 20.9 7.6 22 12 22s8-1.1 8-2.5v-15M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1Z',
  logout: 'M9 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4.2-4.2',
  play: 'M7 4.5 19 12 7 19.5v-15Z',
  stop: 'M6.5 6.5h11v11h-11z',
  refresh: 'M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  check: 'M5 12.5 10 17.5 19 7',
  close: 'M6 6l12 12M18 6 6 18',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  shield: 'M12 3 20 6v6.2c0 4.6-3.2 7.9-8 9.3-4.8-1.4-8-4.7-8-9.3V6l8-3Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  upload: 'M12 16V4M7.5 8.5 12 4l4.5 4.5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  trendUp: 'M6 17 11 12l3 3 5-6M19 9h-4M19 9v4',
  trendDown: 'M6 8l5 5 3-3 5 6M19 16h-4M19 16v-4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  lock: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff: 'M4 4l16 16M9.9 5.8A8.5 8.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.5 8.2A17 17 0 0 0 2.5 12S6 18.5 12 18.5c.8 0 1.5-.1 2.2-.3M9.9 10a3 3 0 0 0 4.2 4.2',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
  code: 'M8.5 8 4.5 12l4 4M15.5 8l4 4-4 4',
  stream: 'M4 7h10M4 12h16M4 17h7M18 5.5v3M18 15.5v3',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  wallet: 'M3 8a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2M3 8v9a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3M20 10h-4a2 2 0 0 0 0 4h4v-4Z',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5ZM14 3v5h5',
  pause: 'M9 5.5v13M15 5.5v13',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.8 9.3a2.3 2.3 0 0 1 4.4.8c0 1.6-2.2 2-2.2 3.4M12 17h.01',
  arrowRight: 'M5 12h13M13 6l6 6-6 6',
};

export function Icon({ name, className = 'h-4 w-4', strokeWidth = 1.7, ...rest }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={path} />
    </svg>
  );
}

export function Logo({ className = 'h-8 w-8', mark = '#E8582A', body = '#0B1220' }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill={body} />
      <path
        d="M16 5.5 24.5 9v7.1c0 5.2-3.4 8.9-8.5 10.4-5.1-1.5-8.5-5.2-8.5-10.4V9L16 5.5Z"
        fill="none"
        stroke={mark}
        strokeWidth="1.8"
      />
      <path
        d="M10.5 16.4h3l1.8-4.1 2 7 1.7-2.9h2.1"
        fill="none"
        stroke={mark}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ className = '', tone = 'text-ink-900' }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <Logo />
      <span className={`text-[17px] font-semibold tracking-tightest ${tone}`}>
        FraudStream<span className="text-brand-500">.</span>
      </span>
    </span>
  );
}

export default Icon;
