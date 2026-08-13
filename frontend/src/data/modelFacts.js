/**
 * Measured figures from the last full training run.
 *
 * Source of truth: ml-engine/models/model_metadata.json and
 * ml-engine/data/dataset_profile.json. These are copied here so the public
 * landing page can quote real numbers without calling the authenticated API.
 * Re-run `python -m src.training.train` and update this file if the model
 * changes.
 */
export const MODEL_FACTS = {
  trainedOn: 'creditcard.csv (ULB credit card fraud dataset)',
  model: 'XGBoost gradient boosting',
  threshold: 0.1842,

  dataset: {
    rawRows: 284807,
    cleanRows: 283726,
    duplicatesRemoved: 1081,
    fraudRows: 473,
    fraudPercentage: 0.1667,
    imbalanceRatio: 598.84,
    spanHours: 48,
    trainRows: 198608,
    validationRows: 42558,
    testRows: 42560,
  },

  test: {
    prAuc: 0.7629,
    rocAuc: 0.9737,
    precision: 0.75,
    recall: 0.75,
    f1: 0.75,
    falsePositiveRate: 0.0003,
    truePositive: 39,
    falsePositive: 13,
    falseNegative: 13,
    trueNegative: 42495,
  },

  latency: {
    averageMs: 0.97,
    p95Ms: 1.59,
    p99Ms: 1.93,
    targetMs: 50,
  },
};

export const HEADLINE_STATS = [
  {
    value: '0.97 ms',
    label: 'Average scoring latency',
    detail: 'Feature transform plus inference, one transaction at a time',
  },
  {
    value: '1.59 ms',
    label: 'p95 latency',
    detail: '31x inside the 50 ms budget the PRD sets',
  },
  { value: '0.76', label: 'PR-AUC on held-out data', detail: 'Time-aware split, never shuffled' },
  {
    value: '0.03 %',
    label: 'False positive rate',
    detail: '13 false alarms across 42,508 legitimate transactions',
  },
];

export const GENERATOR_SNIPPET = `def transaction_stream(source, *, limit=None, delay_ms=0,
                       should_continue=None):
    """Yield transactions one at a time (PRD FR-008)."""
    with source.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)          # streamed, never loaded whole
        for row_number, row in enumerate(reader, start=1):
            if should_continue is not None and not should_continue():
                return                           # a stop request lands here
            features, event_time, amount = validate_record(row)

            yield TransactionEvent(              # <- one event, then pause
                transaction_id=f"TXN-{row_number:07d}",
                event_time=event_time,
                amount=amount,
                features=features,
                identity=derive_identity(features),
            )`;

export const PIPELINE_STAGES = [
  { name: 'creditcard.csv', kind: 'data' },
  { name: 'Clean + engineer', kind: 'step' },
  { name: 'Time-aware split', kind: 'step' },
  { name: 'Train + compare', kind: 'step' },
  { name: 'Tune threshold', kind: 'step' },
  { name: 'fraud_model.joblib', kind: 'artifact' },
  { name: 'Python generator', kind: 'stream' },
  { name: 'Score + risk band', kind: 'stream' },
  { name: 'Supabase Postgres', kind: 'store' },
  { name: 'Realtime dashboard', kind: 'ui' },
];

export default MODEL_FACTS;
