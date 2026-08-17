import React, { useEffect, useRef, useState } from 'react';
import { Link, Redirect, useHistory, useLocation } from 'react-router-dom';
import { Icon, Logo } from '../components/Icons';
import { Banner, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { MODEL_FACTS } from '../data/modelFacts';
import { formatNumber } from '../utils/format';

const PROOF_POINTS = [
  {
    title: 'Every transaction scored on arrival',
    body: 'A Python generator feeds the model one record at a time, so nothing waits for a batch window.',
  },
  {
    title: 'Sub-millisecond scoring',
    body: `Average inference of ${MODEL_FACTS.latency.averageMs} ms against a ${MODEL_FACTS.latency.targetMs} ms budget.`,
  },
  {
    title: 'Accounts, not just transactions',
    body: 'Repeat suspicious behaviour rolls up into an account risk score with a visible signal breakdown.',
  },
];

export default function Login() {
  useDocumentTitle('Sign in');
  const history = useHistory();
  const location = useLocation();
  const {
    signIn,
    signUp,
    resetPassword,
    updatePassword,
    enterDemoMode,
    supabaseConfigured,
    demoModeAvailable,
    isAuthenticated,
    passwordRecovery,
  } = useAuth();

  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // A successful sign-in unmounts this component via the redirect, so state
  // updates in the finally blocks below have to be guarded.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const redirectTo =
    (location.state && location.state.from && location.state.from.pathname) || '/app';

  // A recovery link signs the visitor in before they have set a new password.
  // Redirecting on that session would drop them into the console with the old
  // password still in force and no way back to this form.
  const activeMode = passwordRecovery ? 'update' : mode;

  // Redirect declaratively rather than pushing history during render.
  if (isAuthenticated && !passwordRecovery) {
    return <Redirect to={redirectTo} />;
  }

  const onSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (activeMode === 'update') {
        await updatePassword(password);
        history.replace(redirectTo);
      } else if (activeMode === 'signup') {
        const result = await signUp(email, password, fullName);
        if (result && result.session) {
          history.replace(redirectTo);
        } else {
          setNotice('Account created. Check your inbox to confirm the address, then sign in.');
          setMode('signin');
        }
      } else if (activeMode === 'reset') {
        await resetPassword(email);
        setNotice('Password reset link sent, if that address has an account.');
        setMode('signin');
      } else {
        await signIn(email, password);
        history.replace(redirectTo);
      }
    } catch (submitError) {
      if (mounted.current) setError(submitError.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const onDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      // Explicitly a demo session, not a sign-in that happens to succeed.
      enterDemoMode();
      history.replace(redirectTo);
    } catch (demoError) {
      if (mounted.current) setError(demoError.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_0.85fr]">
      {/* form side */}
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5" aria-label="FraudStream AI home">
            <Logo />
            <span className="text-[17px] font-semibold tracking-tightest text-ink-900">
              FraudStream<span className="text-brand-500">.</span>
            </span>
          </Link>
          <Link to="/" className="btn-ghost btn-sm">
            <Icon name="chevronRight" className="h-3.5 w-3.5 rotate-180" />
            Back to site
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <h1 className="text-[26px] font-semibold tracking-tightest text-ink-900">
            {activeMode === 'update'
              ? 'Choose a new password'
              : activeMode === 'signup'
                ? 'Create your analyst account'
                : activeMode === 'reset'
                  ? 'Reset your password'
                  : 'Sign in to the console'}
          </h1>
          <p className="mt-2 text-[14px] text-ink-500">
            {activeMode === 'update'
              ? 'Your recovery link is verified. Set the password you will use from now on.'
              : activeMode === 'signup'
                ? 'Accounts are managed by Supabase Auth. A profile row is created automatically.'
                : activeMode === 'reset'
                  ? 'We will email a recovery link to the address on your account.'
                  : 'Access the live monitor, fraud alerts and model analytics.'}
          </p>

          {!supabaseConfigured && !demoModeAvailable ? (
            <div className="mt-5">
              <Banner tone="error" title="Authentication is not configured">
                This build has no Supabase credentials, so no one can sign in. Set
                <span className="mono"> VITE_SUPABASE_URL</span> and
                <span className="mono"> VITE_SUPABASE_ANON_KEY</span> on the deployment and
                rebuild.
              </Banner>
            </div>
          ) : null}

          {!supabaseConfigured && demoModeAvailable ? (
            <div className="mt-5 rounded-xl border border-brand-200/80 bg-brand-50/60 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600">
                  <Icon name="check" className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-ink-900">Instant Demo Access</p>
                  <p className="mt-0.5 text-2xs leading-relaxed text-ink-600">
                    Explore live streaming, instant transaction scoring, fraud alerts, and model analytics with 1 click.
                  </p>
                  <button
                    type="button"
                    onClick={onDemo}
                    disabled={busy}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-brand-700 active:scale-[0.99] disabled:opacity-50"
                  >
                    {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
                    Enter Console (Demo Mode) →
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4">
              <Banner tone="error">{error}</Banner>
            </div>
          ) : null}
          {notice ? (
            <div className="mt-4">
              <Banner tone="success">{notice}</Banner>
            </div>
          ) : null}

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            {activeMode === 'signup' ? (
              <div>
                <label className="field-label" htmlFor="fullName">
                  Full name
                </label>
                <input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className="field-input"
                  placeholder="Alex Morgan"
                />
              </div>
            ) : null}

            {activeMode !== 'update' ? (
              <div>
                <label className="field-label" htmlFor="email">
                  Work email
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
                    <Icon name="mail" className="h-4 w-4" />
                  </span>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="field-input pl-9"
                    placeholder="analyst@company.com"
                  />
                </div>
              </div>
            ) : null}

            {activeMode !== 'reset' ? (
              <div>
                <div className="flex items-center justify-between">
                  <label className="field-label" htmlFor="password">
                    {activeMode === 'update' ? 'New password' : 'Password'}
                  </label>
                  {activeMode === 'signin' ? (
                    <button
                      type="button"
                      className="mb-1.5 text-[12.5px] font-medium text-brand-600 hover:text-brand-700"
                      onClick={() => {
                        setMode('reset');
                        setError(null);
                      }}
                    >
                      Forgot password?
                    </button>
                  ) : null}
                </div>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
                    <Icon name="lock" className="h-4 w-4" />
                  </span>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoComplete={
                      activeMode === 'signup' || activeMode === 'update'
                        ? 'new-password'
                        : 'current-password'
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="field-input pl-9 pr-10"
                    placeholder="At least 6 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-400 hover:text-ink-700"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={busy || (!supabaseConfigured && !demoModeAvailable)}
            >
              {busy ? <Spinner className="h-4 w-4" /> : null}
              {activeMode === 'update'
                ? 'Set new password'
                : activeMode === 'signup'
                  ? 'Create account'
                  : activeMode === 'reset'
                    ? 'Send reset link'
                    : 'Sign in'}
            </button>
          </form>

          {demoModeAvailable && supabaseConfigured ? (
            <div className="mt-4">
              <button type="button" className="btn-outline w-full" onClick={onDemo} disabled={busy}>
                Continue with Demo Mode
              </button>
              <p className="mt-2 text-2xs leading-relaxed text-ink-500">
                Skips authentication and enters the live console immediately.
              </p>
            </div>
          ) : null}

          <p className={`mt-6 text-[13.5px] text-ink-500 ${activeMode === 'update' ? 'hidden' : ''}`}>
            {activeMode === 'signin' ? (
              <>
                Need an account?{' '}
                <button
                  type="button"
                  className="font-semibold text-brand-600 hover:text-brand-700"
                  onClick={() => {
                    setMode('signup');
                    setError(null);
                  }}
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already registered?{' '}
                <button
                  type="button"
                  className="font-semibold text-brand-600 hover:text-brand-700"
                  onClick={() => {
                    setMode('signin');
                    setError(null);
                  }}
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        <p className="mx-auto w-full max-w-[400px] text-2xs leading-relaxed text-ink-400">
          Sessions are issued by Supabase Auth. The detection API verifies every request against
          that session; no service-role key is present in this app.
        </p>
      </div>

      {/* proof side */}
      <aside className="dark-surface relative hidden flex-col justify-between bg-ink-900 p-12 text-white lg:flex">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-brand-300">
            Detection console
          </p>
          <h2 className="mt-4 max-w-sm text-[30px] font-semibold leading-tight tracking-tightest text-white">
            Start the stream and watch every transaction get scored.
          </h2>
        </div>

        <ul className="space-y-6">
          {PROOF_POINTS.map((point) => (
            <li key={point.title} className="flex gap-3">
              <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand-400/40 text-brand-300">
                <Icon name="check" className="h-3.5 w-3.5" />
              </span>
              <div>
                <p className="text-[14.5px] font-semibold text-white">{point.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-white/60">{point.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="rounded-lg border border-white/12 p-5">
          <div className="grid grid-cols-3 gap-4">
            {[
              ['Transactions', formatNumber(MODEL_FACTS.dataset.cleanRows)],
              ['Confirmed frauds', formatNumber(MODEL_FACTS.dataset.fraudRows)],
              ['PR-AUC', MODEL_FACTS.test.prAuc],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="tabular text-[19px] font-semibold leading-none text-white">{value}</p>
                <p className="mt-1.5 text-2xs uppercase tracking-[0.1em] text-white/45">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
