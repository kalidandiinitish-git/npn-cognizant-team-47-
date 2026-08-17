import React, { useEffect, useMemo, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { PageHeader } from '../components/app/AppShell';
import {
  Badge,
  Banner,
  Bar,
  Card,
  EmptyState,
  RiskBadge,
  Spinner,
  StatTile,
  TableShell,
  Tabs,
} from '../components/ui';
import { Icon } from '../components/Icons';
import { useAuth } from '../context/AuthContext';
import { useStream } from '../context/StreamContext';
import useDocumentTitle from '../hooks/useDocumentTitle';
import {
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatRatioAsPercent,
  formatRelative,
  formatScore,
  titleCase,
} from '../utils/format';
import { ALERT_STATUSES, ALERT_STATUS_STYLES, alertTypeLabel, riskMeta } from '../utils/risk';

const RESOLUTIONS = [
  ['confirmed_fraud', 'Confirmed fraud'],
  ['legitimate', 'Legitimate transaction'],
  ['false_positive', 'Model false positive'],
  ['duplicate', 'Duplicate case'],
  ['insufficient_evidence', 'Insufficient evidence'],
  ['other', 'Other'],
];

function StatusBadge({ status }) {
  return (
    <Badge className={ALERT_STATUS_STYLES[status] || ALERT_STATUS_STYLES.open}>
      {titleCase(status)}
    </Badge>
  );
}

function EvidencePanel({ investigation }) {
  const explanation = investigation.explanation || {};
  const features = explanation.features || [];
  const reasons = investigation.reason_codes || [];
  const largest = Math.max(...features.map((item) => Math.abs(Number(item.contribution) || 0)), 0.0001);

  return (
    <div className="space-y-4">
      <Card>
        <div className="border-b border-hairline px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Model explanation</p>
              <h3 className="mt-1 text-[15px] font-semibold text-ink-900">Top decision drivers</h3>
            </div>
            <Badge
              className={
                explanation.available
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }
            >
              {explanation.available ? 'TreeSHAP ready' : 'Unavailable'}
            </Badge>
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">
            Contributions are additive in raw model margin space. Positive values raise fraud risk;
            negative values reduce it.
          </p>
        </div>

        {features.length ? (
          <div className="space-y-3 px-5 py-4">
            {features.map((feature) => {
              const contribution = Number(feature.contribution) || 0;
              const raisesRisk = contribution >= 0;
              return (
                <div key={`${feature.rank}-${feature.name}`}>
                  <div className="mb-1 flex items-center justify-between gap-4 text-[12.5px]">
                    <span className="font-medium text-ink-800">
                      {feature.rank}. {feature.name}
                    </span>
                    <span className={`tabular font-semibold ${raisesRisk ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {raisesRisk ? '+' : ''}{contribution.toFixed(5)}
                    </span>
                  </div>
                  <Bar
                    value={Math.abs(contribution)}
                    max={largest}
                    height="h-1.5"
                    className={raisesRisk ? 'bg-rose-500' : 'bg-emerald-500'}
                  />
                  <p className="mt-1 text-2xs text-ink-500">
                    observed {formatScore(feature.raw_value, 4)} · {raisesRisk ? 'raises' : 'reduces'} risk
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon="info"
            title="Contribution detail unavailable"
            description={explanation.reason || 'The active estimator did not expose native contributions.'}
          />
        )}
      </Card>

      <Card>
        <div className="border-b border-hairline px-5 py-4">
          <p className="eyebrow">Reason codes</p>
          <h3 className="mt-1 text-[15px] font-semibold text-ink-900">Human-readable evidence</h3>
        </div>
        <ul className="divide-y divide-hairline">
          {reasons.map((reason) => (
            <li key={reason.code} className="px-5 py-3.5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600">
                  <Icon name={reason.category === 'model' ? 'target' : 'activity'} className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink-900">{reason.label}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-500">{reason.detail}</p>
                  <p className="mt-1 text-2xs text-ink-400">
                    Observed {String(reason.observed)} · threshold {String(reason.threshold)}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function CaseDrawer({ investigation, loading, loadError, onClose, onChange, actions, user }) {
  const [note, setNote] = useState('');
  const [resolutionCode, setResolutionCode] = useState('confirmed_fraud');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [confidence, setConfidence] = useState('0.90');
  const [busyAction, setBusyAction] = useState(null);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    setNote('');
    setResolutionSummary('');
    setActionError(null);
  }, [investigation && investigation.case_id]);

  const run = async (name, callback) => {
    setBusyAction(name);
    setActionError(null);
    try {
      const updated = await callback();
      onChange(updated);
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusyAction(null);
    }
  };

  if (!investigation && !loading && !loadError) return null;

  const assignedToUser = Boolean(
    investigation && investigation.assignee && user && investigation.assignee.id === user.id,
  );
  const transaction = (investigation && investigation.transaction) || {};
  const events = (investigation && investigation.events) || [];
  const notes = (investigation && investigation.notes) || [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Investigation detail">
      <button type="button" className="flex-1 bg-ink-950/40" onClick={onClose} aria-label="Close investigation" />
      <div className="scroll-thin w-full max-w-[860px] overflow-y-auto border-l border-hairline bg-paper shadow-panel">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-hairline bg-white/95 px-5 py-4 backdrop-blur">
          <div>
            <p className="eyebrow">Investigation case</p>
            <p className="mono mt-1 text-[15px] font-semibold text-ink-900">
              {investigation ? investigation.case_number : 'Loading case'}
            </p>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Close detail">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </header>

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center gap-2 text-[13.5px] text-ink-500">
            <Spinner /> Loading investigation evidence
          </div>
        ) : loadError ? (
          <div className="p-5"><Banner tone="error" title="Could not load this case">{loadError}</Banner></div>
        ) : investigation ? (
          <div className="space-y-5 p-5">
            {actionError ? <Banner tone="error" title="Case update failed">{actionError}</Banner> : null}

            <Card>
              <div className="grid gap-px bg-hairline sm:grid-cols-4">
                <div className="bg-white p-4">
                  <p className="eyebrow">Risk</p>
                  <div className="mt-2"><RiskBadge level={investigation.risk_level} /></div>
                  <p className="tabular mt-2 text-[22px] font-semibold text-ink-900">{formatScore(investigation.risk_score)}</p>
                </div>
                <div className="bg-white p-4">
                  <p className="eyebrow">Workflow</p>
                  <div className="mt-2"><StatusBadge status={investigation.status} /></div>
                  <p className="mt-2 text-[12.5px] text-ink-500">Version {investigation.version}</p>
                </div>
                <div className="bg-white p-4">
                  <p className="eyebrow">Assignee</p>
                  <p className="mt-2 truncate text-[13px] font-semibold text-ink-900">
                    {investigation.assignee ? investigation.assignee.email || investigation.assignee.id : 'Unassigned'}
                  </p>
                  <button
                    type="button"
                    className="mt-2 text-[12.5px] font-semibold text-brand-600 hover:text-brand-700"
                    disabled={Boolean(busyAction)}
                    onClick={() => run('assignment', () =>
                      actions.assignInvestigation(investigation.case_id, {
                        assignee_id: assignedToUser ? null : user.id,
                        assignee_email: assignedToUser ? null : user.email,
                        expected_version: investigation.version,
                      }))}
                  >
                    {busyAction === 'assignment' ? 'Saving…' : assignedToUser ? 'Unassign me' : 'Assign to me'}
                  </button>
                </div>
                <div className="bg-white p-4">
                  <p className="eyebrow">Opened</p>
                  <p className="mt-2 text-[13px] font-semibold text-ink-900">{formatDateTime(investigation.created_at)}</p>
                  <p className="mt-2 text-[12.5px] text-ink-500">{formatRelative(investigation.created_at)}</p>
                </div>
              </div>
            </Card>

            <div className="grid gap-5 xl:grid-cols-[1.35fr_0.85fr]">
              <EvidencePanel investigation={investigation} />

              <div className="space-y-4">
                <Card>
                  <div className="border-b border-hairline px-5 py-4">
                    <p className="eyebrow">Transaction snapshot</p>
                    <p className="mono mt-1 text-[13px] font-semibold text-ink-900">{investigation.transaction_id}</p>
                  </div>
                  <dl className="px-5 py-2">
                    {[
                      ['Account', investigation.account_id],
                      ['Amount', formatCurrency(transaction.transaction_amount)],
                      ['Merchant', transaction.merchant || '--'],
                      ['Location', transaction.location || '--'],
                      ['Channel', titleCase(transaction.channel) || '--'],
                      ['Alert type', alertTypeLabel(investigation.alert_type)],
                      ['Event time', formatDateTime(transaction.transaction_time)],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-start justify-between gap-4 border-b border-hairline/70 py-2.5 last:border-0">
                        <dt className="text-[12.5px] text-ink-500">{label}</dt>
                        <dd className="max-w-[60%] text-right text-[12.5px] font-medium text-ink-900">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>

                <Card>
                  <div className="border-b border-hairline px-5 py-4">
                    <p className="eyebrow">Case control</p>
                    <h3 className="mt-1 text-[15px] font-semibold text-ink-900">Analyst workflow</h3>
                  </div>
                  <div className="space-y-4 px-5 py-4">
                    <div>
                      <label className="field-label" htmlFor="investigation-status">Status</label>
                      <select
                        id="investigation-status"
                        className="field-input"
                        value={investigation.status}
                        disabled={Boolean(busyAction)}
                        onChange={(event) => run('status', () =>
                          actions.setInvestigationStatus(investigation.case_id, {
                            status: event.target.value,
                            expected_version: investigation.version,
                          }))}
                      >
                        {ALERT_STATUSES.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}
                      </select>
                    </div>

                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!note.trim()) return;
                        run('note', () => actions.addInvestigationNote(investigation.case_id, {
                          body: note.trim(),
                          expected_version: investigation.version,
                        })).then(() => setNote(''));
                      }}
                    >
                      <label className="field-label" htmlFor="case-note">Add analyst note</label>
                      <textarea
                        id="case-note"
                        className="field-input min-h-[86px] resize-y"
                        value={note}
                        maxLength={4000}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="Record evidence, customer contact, or next steps…"
                      />
                      <button type="submit" className="btn-outline btn-sm mt-2 w-full" disabled={!note.trim() || Boolean(busyAction)}>
                        {busyAction === 'note' ? <Spinner /> : <Icon name="file" className="h-3.5 w-3.5" />}
                        Save note
                      </button>
                    </form>
                  </div>
                </Card>

                <Card>
                  <div className="border-b border-hairline px-5 py-4">
                    <p className="eyebrow">Resolution feedback</p>
                    <h3 className="mt-1 text-[15px] font-semibold text-ink-900">Close the learning loop</h3>
                  </div>
                  <form
                    className="space-y-3 px-5 py-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!resolutionSummary.trim()) return;
                      run('resolution', () => actions.resolveInvestigation(investigation.case_id, {
                        code: resolutionCode,
                        summary: resolutionSummary.trim(),
                        confidence: confidence === '' ? null : Number(confidence),
                        expected_version: investigation.version,
                      }));
                    }}
                  >
                    <div>
                      <label className="field-label" htmlFor="resolution-code">Outcome</label>
                      <select id="resolution-code" className="field-input" value={resolutionCode} onChange={(event) => setResolutionCode(event.target.value)}>
                        {RESOLUTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="field-label" htmlFor="resolution-confidence">Confidence (0–1)</label>
                      <input id="resolution-confidence" className="field-input" type="number" min="0" max="1" step="0.05" value={confidence} onChange={(event) => setConfidence(event.target.value)} />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="resolution-summary">Decision rationale</label>
                      <textarea id="resolution-summary" className="field-input min-h-[86px] resize-y" value={resolutionSummary} maxLength={2000} onChange={(event) => setResolutionSummary(event.target.value)} placeholder="Summarize the evidence behind the outcome…" />
                    </div>
                    <button type="submit" className="btn-primary btn-sm w-full" disabled={!resolutionSummary.trim() || Boolean(busyAction)}>
                      {busyAction === 'resolution' ? <Spinner /> : <Icon name="check" className="h-3.5 w-3.5" />}
                      Resolve case
                    </button>
                  </form>
                </Card>
              </div>
            </div>

            <Card>
              <div className="border-b border-hairline px-5 py-4">
                <p className="eyebrow">Audit trail</p>
                <h3 className="mt-1 text-[15px] font-semibold text-ink-900">Case activity</h3>
              </div>
              <div className="grid gap-px bg-hairline md:grid-cols-2">
                <div className="bg-white px-5 py-4">
                  <p className="mb-3 text-[12.5px] font-semibold text-ink-700">Workflow events</p>
                  <ol className="space-y-3">
                    {[...events].reverse().map((event) => (
                      <li key={event.id} className="border-l-2 border-brand-200 pl-3">
                        <p className="text-[12.5px] font-medium text-ink-800">{event.detail}</p>
                        <p className="mt-0.5 text-2xs text-ink-500">{event.actor.email || event.actor.id} · {formatRelative(event.created_at)}</p>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="bg-white px-5 py-4">
                  <p className="mb-3 text-[12.5px] font-semibold text-ink-700">Analyst notes</p>
                  {notes.length ? (
                    <ol className="space-y-3">
                      {[...notes].reverse().map((item) => (
                        <li key={item.id} className="rounded-md border border-hairline bg-paper p-3">
                          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-800">{item.body}</p>
                          <p className="mt-1.5 text-2xs text-ink-500">{item.author.email || item.author.id} · {formatRelative(item.created_at)}</p>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="text-[12.5px] text-ink-500">No analyst notes yet.</p>}
                </div>
              </div>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function Investigations() {
  useDocumentTitle('Investigations');
  const location = useLocation();
  const history = useHistory();
  const { user, email } = useAuth();
  const {
    investigations,
    investigationMetrics,
    initialising,
    refreshInvestigations,
    getInvestigation,
    assignInvestigation,
    addInvestigationNote,
    setInvestigationStatus,
    resolveInvestigation,
  } = useStream();

  const [statusFilter, setStatusFilter] = useState('active');
  const [riskFilter, setRiskFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const caseId = new URLSearchParams(location.search).get('case');

  useEffect(() => {
    let active = true;
    if (!caseId) {
      setDetail(null);
      setDetailError(null);
      return () => { active = false; };
    }
    setDetailLoading(true);
    setDetailError(null);
    getInvestigation(caseId)
      .then((nextCase) => {
        if (active) setDetail(nextCase);
      })
      .catch((error) => {
        if (active) setDetailError(error.message);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => { active = false; };
  }, [caseId, getInvestigation]);

  const filtered = useMemo(
    () => investigations.filter((item) => {
      if (statusFilter === 'active' && !['open', 'investigating'].includes(item.status)) return false;
      if (statusFilter !== 'all' && statusFilter !== 'active' && item.status !== statusFilter) return false;
      if (riskFilter !== 'all' && item.risk_level !== riskFilter) return false;
      return true;
    }),
    [investigations, riskFilter, statusFilter],
  );

  const metrics = investigationMetrics || {};
  const activeCount = useMemo(
    () => investigations.filter((item) => ['open', 'investigating'].includes(item.status)).length,
    [investigations],
  );
  const unassignedCount = useMemo(
    () => investigations.filter((item) => !item.assignee && ['open', 'investigating'].includes(item.status)).length,
    [investigations],
  );
  // Confirmed fraud is an analyst outcome, so only a recorded resolution of
  // confirmed_fraud counts. This used to treat any resolved case that was not
  // explicitly false_positive or dismissed as a confirmation, which counted
  // three things that are not fraud: a case closed as `legitimate`, one closed
  // as `insufficient_evidence`, and -- most often -- a case with no resolution
  // at all, because moving an alert to Resolved from the triage dropdown sets
  // the case status without recording an outcome. A fraud console must never
  // claim a confirmation nobody made. The engine already counts this correctly
  // from the resolution codes themselves (investigations/store.py::metrics).
  const confirmedCount = useMemo(() => {
    if (typeof metrics.confirmed_fraud === 'number') return metrics.confirmed_fraud;
    return investigations.filter((item) => item.resolution_code === 'confirmed_fraud').length;
  }, [metrics.confirmed_fraud, investigations]);
  const resolvedCount = useMemo(
    () => investigations.filter((item) => item.status === 'resolved').length,
    [investigations],
  );
  const dismissedCount = useMemo(
    () => investigations.filter((item) => item.status === 'dismissed').length,
    [investigations],
  );

  const analyst = user || { id: 'local-dev', email: email || 'local@dev' };

  const openCase = (id) => history.push(`/app/investigations?case=${encodeURIComponent(id)}`);
  const closeCase = () => history.replace('/app/investigations');

  return (
    <>
      <PageHeader
        title="Investigation workbench"
        subtitle="Explain model decisions, coordinate analyst review, and capture resolution feedback."
      >
        <button type="button" className="btn-outline btn-sm" onClick={refreshInvestigations}>
          <Icon name="refresh" className="h-3.5 w-3.5" /> Refresh
        </button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Active cases" value={formatNumber(activeCount)} hint="open and investigating" icon="shield" tone={activeCount ? 'alert' : 'default'} />
        <StatTile label="Unassigned" value={formatNumber(unassignedCount)} hint="awaiting ownership" icon="users" />
        <StatTile label="Confirmed fraud" value={formatNumber(confirmedCount)} hint="analyst outcomes" icon="check" />
        <StatTile
          label="Mean resolution"
          value={metrics.average_resolution_seconds === null || metrics.average_resolution_seconds === undefined ? '--' : formatDuration(metrics.average_resolution_seconds)}
          hint={metrics.analyst_confirmation_rate === null || metrics.analyst_confirmation_rate === undefined ? 'no outcomes yet' : `${formatRatioAsPercent(metrics.analyst_confirmation_rate)} confirmation`}
          icon="clock"
        />
      </div>

      <div className="mt-4">
        <Card>
          <div className="flex flex-col gap-3 border-b border-hairline px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <Tabs
              ariaLabel="Filter cases by status"
              value={statusFilter}
              onChange={setStatusFilter}
              items={[
                { value: 'active', label: 'Active', count: activeCount },
                { value: 'all', label: 'All', count: investigations.length },
                { value: 'resolved', label: 'Resolved', count: resolvedCount },
                { value: 'dismissed', label: 'Dismissed', count: dismissedCount },
              ]}
            />
            <Tabs
              ariaLabel="Filter cases by risk"
              value={riskFilter}
              onChange={setRiskFilter}
              items={[
                { value: 'all', label: 'Any risk' },
                { value: 'high', label: 'High' },
                { value: 'critical', label: 'Critical' },
              ]}
            />
          </div>

          {initialising && !investigations.length ? (
            <div className="flex items-center justify-center gap-2 px-6 py-14 text-[13.5px] text-ink-500"><Spinner /> Loading cases</div>
          ) : filtered.length ? (
            <TableShell>
              <thead>
                <tr>
                  <th className="th">Case</th>
                  <th className="th">Risk</th>
                  <th className="th">Primary evidence</th>
                  <th className="th">Assignee</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Updated</th>
                  <th className="th" aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const primary = item.reason_codes && item.reason_codes[0];
                  const meta = riskMeta(item.risk_level);
                  return (
                    <tr key={item.case_id} className="transition-colors hover:bg-paper">
                      <td className="td">
                        <button type="button" className="text-left" onClick={() => openCase(item.case_id)}>
                          <span className="mono block font-semibold text-brand-600 hover:underline">{item.case_number}</span>
                          <span className="mono text-2xs text-ink-500">{item.transaction_id}</span>
                        </button>
                      </td>
                      <td className="td w-[132px]">
                        <div className="flex items-center gap-2"><RiskBadge level={item.risk_level} /><span className="tabular font-medium">{formatScore(item.risk_score)}</span></div>
                        <div className="mt-1.5"><Bar value={item.risk_score} max={1} height="h-1" className={meta.bar} /></div>
                      </td>
                      <td className="td">
                        <span className="block font-medium text-ink-800">{primary ? primary.label : alertTypeLabel(item.alert_type)}</span>
                        <span className="text-2xs text-ink-500">{item.explanation_available ? 'Model explanation available' : 'Reason codes only'} · {formatNumber(item.note_count)} notes</span>
                      </td>
                      <td className="td text-ink-600">{item.assignee ? item.assignee.email || item.assignee.id : 'Unassigned'}</td>
                      <td className="td"><StatusBadge status={item.status} /></td>
                      <td className="td text-right text-ink-500"><span className="block">{formatDateTime(item.updated_at)}</span><span className="text-2xs">{formatRelative(item.updated_at)}</span></td>
                      <td className="td text-right"><button type="button" className="btn-ghost btn-sm" onClick={() => openCase(item.case_id)} aria-label={`Open ${item.case_number}`}><Icon name="chevronRight" className="h-4 w-4" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>
          ) : (
            <EmptyState icon="shield" title="No cases match this view" description="Start the stream to generate explainable cases, or change the status and risk filters." />
          )}
        </Card>
      </div>

      {caseId ? (
        <CaseDrawer
          investigation={detail}
          loading={detailLoading}
          loadError={detailError}
          onClose={closeCase}
          onChange={setDetail}
          user={analyst}
          actions={{ assignInvestigation, addInvestigationNote, setInvestigationStatus, resolveInvestigation }}
        />
      ) : null}
    </>
  );
}
