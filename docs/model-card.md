# Model card: FraudStream AI detector v1.0.0

Generated from the training run recorded in
`ml-engine/models/model_metadata.json`. Re-run
`python -m src.training.train` to refresh both.

## Overview

| Field | Value |
| --- | --- |
| Task | Binary classification: is this card transaction fraudulent |
| Selected model | XGBoost (`XGBClassifier`, hist tree method, 400 rounds, depth 5) |
| Imbalance handling | `scale_pos_weight` from the training class ratio |
| Decision threshold | 0.1842 |
| Threshold strategy | Maximise F2 subject to precision >= 0.50 |
| Artifacts | `fraud_model.joblib`, `preprocessor.joblib`, `model_metadata.json` |

## Intended use

Scoring individual card transactions in near real time so analysts can triage
high-risk activity. It produces a risk score and a recommended action, not a
final decision. The critical band is labelled "alert and investigate", not
"block", on purpose.

**Not intended for**: automated blocking without human review, credit decisions,
or any use on populations unlike the training data.

## Data

Public ULB credit card fraud dataset (`creditcard.csv`), two days of European
cardholder transactions from September 2013.

| Property | Value |
| --- | --- |
| Rows read | 284,807 |
| Duplicates removed | 1,081 |
| Rows with missing required values | 0 |
| Out-of-range rows removed | 0 |
| Rows used | 283,726 |
| Fraudulent | 473 (0.1667 %) |
| Class ratio | 1 fraud per 599 legitimate |
| Time span | 48 hours |
| Amount mean / max | 88.47 / 25,691.16 |
| Fraud amount mean | 123.87 |

Features V1..V28 are PCA components published in place of the original fields.
The dataset contains no direct identifiers.

### Split

Chronological, by `Time`, never shuffled:

| Split | Rows | Frauds |
| --- | --- | --- |
| Train | 198,608 | 366 |
| Validation | 42,558 | 55 |
| Test | 42,560 | 52 |

Validation is used only for threshold tuning and model selection. The test split
is scored once, and is also the file the live stream replays.

## Features

33 inputs:

- `V1`..`V28` - the published PCA components.
- `amount`, `log_amount` - raw and log1p amount.
- `seconds_of_day`, `hour_of_day`, `is_night` - derived from elapsed time.

Preprocessing is median imputation then standardisation, fitted on the training
split only and serialised separately so serving cannot drift from training.

### Deliberately excluded

`account_id`, `card_last4`, `merchant`, `merchant_category`, `location`, `channel`.

These are derived in `features/identity.py` from a hash of the PCA signature,
because the anonymised dataset has no such fields and account-level risk needs a
stable grouping key. They exist only for aggregation and display. Feeding a
label-correlated hash into the model would be leakage, so `MODEL_FEATURES`
excludes them and a test enforces it.

## Metrics

Threshold-dependent figures use the tuned threshold of 0.1842.

| Metric | Validation | Test |
| --- | --- | --- |
| PR-AUC | 0.8472 | 0.7629 |
| ROC-AUC | 0.9880 | 0.9737 |
| Precision | 0.8824 | 0.7500 |
| Recall | 0.8182 | 0.7500 |
| F1 | 0.8491 | 0.7500 |
| False positive rate | - | 0.0003 |

Test confusion matrix:

| | Predicted fraud | Predicted legitimate |
| --- | --- | --- |
| **Actually fraud** | 39 | 13 |
| **Actually legitimate** | 13 | 42,495 |

In practice: 39 of 52 frauds caught, at the cost of 13 false alarms out of 42,508
legitimate transactions.

Accuracy is not reported. Predicting "never fraud" would score 99.88 % accuracy
and catch nothing.

## Candidate comparison (validation split)

| Model | PR-AUC | ROC-AUC | Precision | Recall | p95 latency | Fit time |
| --- | --- | --- | --- | --- | --- | --- |
| Random forest | 0.8715 | 0.9783 | 0.9375 | 0.8182 | 33.2 ms | 44.0 s |
| **XGBoost (selected)** | 0.8472 | 0.9880 | 0.8824 | 0.8182 | 1.76 ms | 4.8 s |
| Logistic regression | 0.8414 | 0.9817 | 0.8431 | 0.7818 | 2.23 ms | 1.1 s |
| Isolation forest | 0.0553 | 0.9541 | 0.0812 | 0.5273 | 6.13 ms | 2.0 s |

### Why XGBoost and not the random forest

Selection applies a hard gate at 50 ms p95 and prefers candidates that keep 2x
headroom (p95 under 25 ms). The random forest has the best PR-AUC but its p95 of
33 ms consumes two thirds of the budget on an idle laptop, leaving nothing for a
loaded host. XGBoost gives up 0.024 PR-AUC and runs roughly 19x faster.

### Anomaly detection baselines

The requirements name three unsupervised detectors, and all three are trained and
compared on every run:

| Detector | How it is fitted |
| --- | --- |
| Isolation forest | The training split as it comes, with `contamination` set to the observed fraud rate. |
| Local outlier factor | `novelty=True`, on a bounded random sample of legitimate rows only. |
| One-Class SVM | RBF kernel, `nu` floored at 0.01, on the same legitimate-only sample. |

The last two are *novelty* detectors: they assume the data they are fitted on is
clean, so fitting them on the contaminated split would teach them that fraud is
normal. Both also scale badly - LOF keeps every reference point and queries them
at predict time, One-Class SVM training is quadratic in the sample size - so the
fit sample is capped at `TrainingConfig.anomaly_fit_sample` (20 000 rows) to keep
training tractable and serving inside the 50 ms budget.

The isolation forest's PR-AUC of 0.055 against a supervised 0.85 is the useful
result: with labels available, unsupervised anomaly detection is the wrong tool
here. Its ROC-AUC of 0.954 looks respectable, which illustrates why ROC-AUC
misleads under extreme imbalance.

> The LOF and One-Class SVM rows are absent from the table above because the
> shipped artifacts were trained before those candidates existed. They appear in
> `model_metadata.json` -> `candidates` after the next full retrain, which needs
> `creditcard.csv` (see [Reproducing](#reproducing)). Both were verified end to
> end on the held-out split; no full-dataset numbers are claimed for them yet.

## Class imbalance handling

Fraud is 0.167 % of the dataset, roughly 1 in 600. Four levers are available, and
all resampling is applied to the training split only - resampling validation or
test would inflate precision by deleting the transactions the model must avoid
flagging:

| Lever | Status | How |
| --- | --- | --- |
| Class weighting | **On by default** | `scale_pos_weight` (XGBoost), `class_weight='balanced'` (logistic regression, random forest) |
| Threshold tuning | **On by default** | Maximise F2 subject to precision >= 0.50 |
| PR-first evaluation | **On by default** | PR-AUC, precision, recall, F1 and the PR curve; accuracy is not reported |
| Random undersampling | Opt-in | `--undersample RATIO`, e.g. `0.1` for 1 fraud per 10 legitimate; every fraud row is kept |
| SMOTE | Opt-in | `--smote`, synthesises minority rows to a 0.1 ratio |

The defaults use class weighting rather than resampling: reweighting the loss
keeps every real legitimate transaction in the split, while undersampling throws
away the majority-class detail the model needs to keep false positives low. The
resampling flags exist so the trade-off can be measured rather than asserted, and
whatever was used is recorded in `model_metadata.json` -> `imbalance_handling`.

## Latency

Measured over 500 single-transaction predictions through the serving code path
(feature build, transform, inference):

| Statistic | Value |
| --- | --- |
| Average | 0.97 ms |
| Median | 0.94 ms |
| p95 | 1.59 ms |
| p99 | 1.93 ms |
| Target | 50 ms |

## Risk score mapping

Raw probabilities from an imbalance-weighted model are not comparable to fixed
band edges, so the probability is rescaled piecewise-linearly:

- `p = 0` maps to 0.00
- `p = threshold` maps to 0.70, the start of the high band
- `p = 1` maps to 1.00

The mapping is monotonic, so the ranking of transactions is unchanged. A
transaction the model would flag always lands in the high or critical band.

| Band | Risk score | Action |
| --- | --- | --- |
| Low | 0.00 - 0.39 | Allow |
| Medium | 0.40 - 0.69 | Monitor |
| High | 0.70 - 0.89 | Flag |
| Critical | 0.90 - 1.00 | Alert and investigate |

## Limitations

- **Two days of data.** No weekly or seasonal patterns are learned.
- **2013 European transactions.** Fraud tactics have moved on; do not read these
  metrics as current production performance.
- **Anonymised features.** No explanation of *why* a transaction scored highly can
  be given in business terms, only which PCA components drove it.
- **Small positive class.** 52 frauds in the test split, so metrics carry wide
  confidence intervals. One extra catch moves recall by about two points.
- **Threshold is dataset-specific.** It must be re-tuned on the target population.
- **Account attributes are synthetic.** Account-level risk demonstrates the
  mechanism correctly, but on real data those signals would be computed from real
  account history.
- **No drift monitoring.** `model_metrics` records evaluation runs; nothing
  currently alerts on live distribution drift.

## Ethical considerations

The dataset contains no demographic attributes, so the model cannot use protected
characteristics directly. It could still act as a proxy through spending patterns,
which is one more reason the critical action is investigation rather than an
automatic block. False positives inconvenience real customers, which is why the
threshold search holds a precision floor rather than maximising recall alone.

## Reproducing

Needs `creditcard.csv`, which is not in the repository (~150 MB). Put it in
`ml-engine/data/`, at the repo root, or point `DATA_PATH` at it.

```powershell
# Windows
cd ml-engine
.\.venv\Scripts\python.exe -m src.training.train --latency-samples 500
```

```bash
# macOS / Linux
cd ml-engine
./.venv/bin/python -m src.training.train --latency-samples 500
```

Useful variations:

```bash
--fast                  # smaller forests and a subsampled split, for a smoke run
--models xgboost,one_class_svm   # train a subset of the candidates
--undersample 0.1       # random undersampling of the training split (FR-004)
--smote                 # SMOTE oversampling of the training split (FR-004)
```

Deterministic given the same data and `random_state = 42`. Latency figures vary
with hardware and load.
