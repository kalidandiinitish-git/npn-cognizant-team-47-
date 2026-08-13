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

The isolation forest is included because the requirements ask for an anomaly
detection baseline. Its PR-AUC of 0.055 against a supervised 0.85 is the useful
result: with labels available, unsupervised anomaly detection is the wrong tool
here. Its ROC-AUC of 0.954 looks respectable, which illustrates why ROC-AUC
misleads under extreme imbalance.

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

```powershell
cd ml-engine
.\.venv\Scripts\python.exe -m src.training.train --latency-samples 500
```

Deterministic given the same data and `random_state = 42`. Latency figures vary
with hardware and load.
