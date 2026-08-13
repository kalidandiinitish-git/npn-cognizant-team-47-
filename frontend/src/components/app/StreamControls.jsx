import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icons';
import { Spinner } from '../ui';
import { useStream } from '../../context/StreamContext';

const SPEEDS = [
  { label: 'Realistic (8/s)', value: 120 },
  { label: 'Fast (25/s)', value: 40 },
  { label: 'Full speed', value: 0 },
];

export default function StreamControls() {
  const { isRunning, busy, startStream, stopStream, streamStatus, health, dataset } = useStream();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(2000);
  const [delay, setDelay] = useState(120);
  const [persist, setPersist] = useState(true);
  const [skip, setSkip] = useState(0);
  const [message, setMessage] = useState(null);
  const popover = useRef(null);

  // Labelled fraud is rare (52 cases in 42,560 rows), so starting from row zero
  // means minutes of clean traffic before anything is flagged. These presets let
  // the operator start near labelled fraud instead; ordering is untouched.
  const fraudIndex = dataset && dataset.fraud_index ? dataset.fraud_index : null;
  const startPoints = [{ value: 0, label: 'From the beginning', detail: 'Chronological, row 1' }];
  if (fraudIndex && fraudIndex.recommended_skip) {
    startPoints.push({
      value: fraudIndex.recommended_skip,
      label: 'At the first labelled fraud',
      detail: `Row ${fraudIndex.recommended_skip.toLocaleString()} of ${fraudIndex.total_rows.toLocaleString()}`,
    });
  }
  if (fraudIndex && fraudIndex.densest_window && fraudIndex.densest_window.start) {
    startPoints.push({
      value: fraudIndex.densest_window.start,
      label: 'Fraud-dense window',
      detail: `Row ${fraudIndex.densest_window.start.toLocaleString()}, ${fraudIndex.densest_window.fraud_count} cases in ${fraudIndex.densest_window.window_size}`,
    });
  }

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event) => {
      if (popover.current && !popover.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const modelMissing = health && health.model_loaded === false;

  const settings = () => ({
    limit: Number(limit),
    delay_ms: Number(delay),
    skip: Number(skip),
    persist,
    reset: true,
  });

  // Top bar button: start when idle, stop when running.
  const onToggle = async () => {
    setMessage(null);
    try {
      if (isRunning) {
        await stopStream();
      } else {
        await startStream(settings());
      }
      setOpen(false);
    } catch (error) {
      setMessage(error.message);
    }
  };

  // Popover button: apply the chosen settings, replacing any active run. The
  // engine refuses a second concurrent stream, so an active one is stopped first.
  const onApply = async () => {
    setMessage(null);
    try {
      if (isRunning) {
        await stopStream();
      }
      await startStream(settings());
      setOpen(false);
    } catch (error) {
      setMessage(error.message);
    }
  };

  return (
    <div className="relative flex items-center gap-2" ref={popover}>
      {streamStatus && streamStatus.processed ? (
        <span className="tabular hidden text-[12.5px] text-ink-500 sm:inline">
          {streamStatus.processed.toLocaleString()} processed
        </span>
      ) : null}

      <button
        type="button"
        className="btn-outline btn-sm"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Icon name="settings" className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Stream</span>
      </button>

      <button
        type="button"
        className={isRunning ? 'btn-danger btn-sm' : 'btn-primary btn-sm'}
        onClick={onToggle}
        disabled={busy || modelMissing}
        title={modelMissing ? 'Train the model before streaming' : undefined}
      >
        {busy ? <Spinner className="h-3.5 w-3.5" /> : <Icon name={isRunning ? 'stop' : 'play'} className="h-3.5 w-3.5" />}
        {isRunning ? 'Stop stream' : 'Start stream'}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Stream settings"
          className="absolute right-0 top-[calc(100%+10px)] z-40 w-[292px] rounded-lg border border-hairline bg-white p-4 shadow-lift"
        >
          <p className="text-[13.5px] font-semibold text-ink-900">Stream settings</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
            Replays the held-out test split through the Python generator.
          </p>

          <label className="mt-4 block" htmlFor="stream-limit">
            <span className="field-label">Transactions to replay</span>
            <input
              id="stream-limit"
              type="number"
              min="1"
              max="50000"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              className="field-input tabular py-2"
            />
          </label>

          {startPoints.length > 1 ? (
            <fieldset className="mt-3">
              <legend className="field-label">Start position</legend>
              <div className="space-y-1.5">
                {startPoints.map((point) => (
                  <label
                    key={point.value}
                    className="flex cursor-pointer items-start gap-2.5 text-[13px] text-ink-700"
                  >
                    <input
                      type="radio"
                      name="stream-skip"
                      value={point.value}
                      checked={Number(skip) === point.value}
                      onChange={() => setSkip(point.value)}
                      className="mt-0.5 h-3.5 w-3.5 accent-brand-500"
                    />
                    <span>
                      {point.label}
                      <span className="block text-2xs text-ink-500">{point.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset className="mt-3">
            <legend className="field-label">Arrival rate</legend>
            <div className="space-y-1.5">
              {SPEEDS.map((speed) => (
                <label
                  key={speed.value}
                  className="flex cursor-pointer items-center gap-2.5 text-[13px] text-ink-700"
                >
                  <input
                    type="radio"
                    name="stream-speed"
                    value={speed.value}
                    checked={Number(delay) === speed.value}
                    onChange={() => setDelay(speed.value)}
                    className="h-3.5 w-3.5 accent-brand-500"
                  />
                  {speed.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-[13px] text-ink-700">
            <input
              type="checkbox"
              checked={persist}
              onChange={(event) => setPersist(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-brand-500"
            />
            <span>
              Write results to Supabase
              <span className="block text-2xs text-ink-500">
                Turn off to keep the run in memory only.
              </span>
            </span>
          </label>

          {message ? (
            <p className="mt-3 rounded border border-rose-200 bg-rose-50 px-2.5 py-2 text-[12.5px] text-rose-700">
              {message}
            </p>
          ) : null}

          <button type="button" className="btn-primary btn-sm mt-4 w-full" onClick={onApply} disabled={busy}>
            {isRunning ? 'Restart with these settings' : 'Start stream'}
          </button>

          {fraudIndex ? (
            <p className="mt-2.5 text-2xs leading-relaxed text-ink-500">
              The held-out split holds {fraudIndex.fraud_count} labelled frauds in{' '}
              {fraudIndex.total_rows.toLocaleString()} rows. Start positions change only where the
              replay begins, not the order of events.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
