import React, { useEffect } from 'react';
import { PageHeader } from '../components/app/AppShell';
import { Banner, Card, CardHeader, DefinitionRow, EmptyState, StatTile } from '../components/ui';
import {
  CandidateComparison,
  ConfusionMatrixGrid,
  LatencyPanel,
  PrCurveChart,
  RiskBandLegend,
} from '../components/app/widgets';
import { useStream } from '../context/StreamContext';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { formatDateTime, formatMs, formatNumber, formatScore, titleCase } from '../utils/format';

export default function Analytics() {
  useDocumentTitle('Model analytics');
  const { model, latency, liveQuality, refreshReference } = useStream();

  useEffect(() => {
    if (refreshReference && !model) {
      refreshReference();
    }
  }, [refreshReference, model]);

  if (!model) {
    return (
      <>
        <PageHeader title="Model analytics" />
        <Card>
          <EmptyState
            icon="chart"
            title="No trained model to report on"
            description="Run python -m src.training.train inside ml-engine. The evaluation report, candidate comparison and precision-recall curve are read straight from model_metadata.json."
          />
        </Card>
      </>
    );
  }

  const test = (model.metrics && model.metrics.test) || {};
  const validation = (model.metrics && model.metrics.validation) || {};
  const dataset = model.dataset || {};
  const distribution = dataset.class_distribution || {};
  const tuning = model.threshold_tuning || {};
  const selection = model.selection || {};

  return (
    <>
      <PageHeader
        title="Model analytics"
        subtitle={`${titleCase(model.model_name)} v${model.version} - trained ${formatDateTime(model.trained_at)}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="PR-AUC" value={formatScore(test.pr_auc, 4)} hint="held-out test split" icon="chart" />
        <StatTile label="ROC-AUC" value={formatScore(test.roc_auc, 4)} hint="test split" icon="chart" />
        <StatTile label="Precision" value={formatScore(test.precision, 4)} hint="of flagged transactions" icon="target" />
        <StatTile label="Recall" value={formatScore(test.recall, 4)} hint="of actual fraud caught" icon="shield" />
        <StatTile label="F1" value={formatScore(test.f1_score, 4)} hint={`FPR ${formatScore(test.false_positive_rate, 5)}`} icon="activity" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Precision-recall curve"
            subtitle="Test split. PR-AUC is the honest headline metric under this much imbalance."
            icon="chart"
          />
          <PrCurveChart curve={model.precision_recall_curve} />
        </Card>

        <Card>
          <CardHeader title="Test split outcomes" subtitle={`${formatNumber((test.support || {}).total)} transactions`} icon="target" />
          <ConfusionMatrixGrid matrix={test.confusion_matrix} title="Confusion matrix, test split" />
          {liveQuality && liveQuality.true_positives + liveQuality.false_negatives > 0 ? (
            <ConfusionMatrixGrid
              matrix={{
                true_positive: liveQuality.true_positives,
                false_positive: liveQuality.false_positives,
                false_negative: liveQuality.false_negatives,
                true_negative: liveQuality.true_negatives,
              }}
              title="Confusion matrix, current stream"
            />
          ) : null}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Candidate comparison"
            subtitle="Validation split. Selection weighs latency alongside detection quality."
            icon="chart"
          />
          <CandidateComparison candidates={model.candidates} selected={model.model_name} />
          {selection.criteria ? (
            <div className="border-t border-hairline bg-paper px-5 py-3.5">
              <p className="text-[12.5px] leading-relaxed text-ink-600">
                <span className="font-semibold text-ink-900">Selection rule.</span>{' '}
                {selection.criteria}.
              </p>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Measured latency" subtitle="Single-transaction path, benchmarked at training time" icon="clock" />
          <LatencyPanel latency={model.latency} />
          {latency && latency.sample_size ? (
            <div className="border-t border-hairline px-5 py-3.5">
              <p className="text-[12.5px] text-ink-600">
                Live stream is currently averaging{' '}
                <span className="tabular font-semibold text-ink-900">{formatMs(latency.average_ms)}</span>{' '}
                across {formatNumber(latency.sample_size)} predictions.
              </p>
            </div>
          ) : null}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Threshold tuning" subtitle="Not left at 0.5" icon="target" />
          <div className="px-5 py-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="eyebrow">Decision threshold</p>
                <p className="tabular mt-1 text-[30px] font-semibold leading-none text-ink-900">
                  {formatScore(model.threshold, 4)}
                </p>
              </div>
              <span className="mono rounded border border-hairline bg-paper px-2 py-1 text-ink-600">
                {tuning.strategy || 'tuned'}
              </span>
            </div>
            <dl className="mt-4">
              <DefinitionRow label="Precision floor">{formatScore(tuning.min_precision, 2)}</DefinitionRow>
              <DefinitionRow label="F-beta weight">{tuning.beta || '--'}</DefinitionRow>
              <DefinitionRow label="Precision at threshold">
                {formatScore(tuning.precision_at_threshold, 4)}
              </DefinitionRow>
              <DefinitionRow label="Recall at threshold">
                {formatScore(tuning.recall_at_threshold, 4)}
              </DefinitionRow>
            </dl>
            {tuning.reason ? (
              <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">{tuning.reason}.</p>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Validation split" subtitle="Used for threshold selection only" icon="chart" />
          <div className="px-5 py-4">
            <dl>
              <DefinitionRow label="PR-AUC">{formatScore(validation.pr_auc, 4)}</DefinitionRow>
              <DefinitionRow label="ROC-AUC">{formatScore(validation.roc_auc, 4)}</DefinitionRow>
              <DefinitionRow label="Precision">{formatScore(validation.precision, 4)}</DefinitionRow>
              <DefinitionRow label="Recall">{formatScore(validation.recall, 4)}</DefinitionRow>
              <DefinitionRow label="F1">{formatScore(validation.f1_score, 4)}</DefinitionRow>
              <DefinitionRow label="Rows">{formatNumber((validation.support || {}).total)}</DefinitionRow>
            </dl>
          </div>
        </Card>

        <Card>
          <CardHeader title="Training data" subtitle="Class imbalance and split sizes" icon="database" />
          <div className="px-5 py-4">
            <dl>
              <DefinitionRow label="Clean transactions">{formatNumber(dataset.rows)}</DefinitionRow>
              <DefinitionRow label="Fraud rows">{formatNumber(distribution.fraud)}</DefinitionRow>
              <DefinitionRow label="Fraud share">{distribution.fraud_percentage}%</DefinitionRow>
              <DefinitionRow label="Imbalance ratio">
                1 : {formatNumber(Math.round(distribution.negative_to_positive_ratio || 0))}
              </DefinitionRow>
              <DefinitionRow label="Split">{(dataset.split || {}).split_method}</DefinitionRow>
              <DefinitionRow label="Test rows">{formatNumber((dataset.split || {}).test_rows)}</DefinitionRow>
            </dl>
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader title="Risk bands in force" subtitle="Model probability is rescaled so the tuned threshold sits at 0.70" icon="target" />
          <div className="px-5 py-4">
            <RiskBandLegend />
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
              Features used: {formatNumber((model.feature_names || []).length)} inputs, the 28 PCA
              components plus engineered amount and time features. Derived attributes such as
              account, merchant and location are deliberately excluded from the model and used only
              for aggregation and display.
            </p>
          </div>
        </Card>
      </div>

      {model.leakage_check && model.leakage_check.passed ? (
        <div className="mt-4">
          <Banner tone="success" title="Leakage check passed">
            No label-derived column appears among the model inputs, and the split is chronological so
            no future transaction informs the past.
          </Banner>
        </div>
      ) : null}
    </>
  );
}
