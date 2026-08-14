export const DATASET_PROFILE = {
  "source_file": "creditcard.csv",
  "rows": 283726,
  "columns": 31,
  "cleaning": {
    "rows_in": 284807,
    "duplicates_removed": 1081,
    "rows_with_missing_values_dropped": 0,
    "out_of_range_rows_dropped": 0,
    "fraud_rows": 473,
    "legitimate_rows": 283253,
    "fraud_rate": 0.001667101358352777,
    "imbalance_ratio": 598.8435517970402,
    "rows_out": 283726,
    "amount_min": 0.0,
    "amount_max": 25691.16,
    "amount_mean": 88.47268731099724,
    "time_min": 0.0,
    "time_max": 172792.0
  },
  "class_distribution": {
    "total": 283726,
    "fraud": 473,
    "legitimate": 283253,
    "fraud_percentage": 0.1667,
    "negative_to_positive_ratio": 598.84
  },
  "amount": {
    "min": 0.0,
    "max": 25691.16,
    "mean": 88.4727,
    "median": 22.0,
    "p95": 365.33750000000003,
    "p99": 1018.965,
    "fraud_mean": 123.8719,
    "legitimate_mean": 88.4136
  },
  "time": {
    "elapsed_seconds": 172792.0,
    "span_hours": 48.0
  },
  "hourly_distribution": [
    {
      "hour": 0,
      "transactions": 7647,
      "fraud": 6
    },
    {
      "hour": 1,
      "transactions": 4208,
      "fraud": 10
    },
    {
      "hour": 2,
      "transactions": 3308,
      "fraud": 48
    },
    {
      "hour": 3,
      "transactions": 3487,
      "fraud": 17
    },
    {
      "hour": 4,
      "transactions": 2204,
      "fraud": 23
    },
    {
      "hour": 5,
      "transactions": 2988,
      "fraud": 11
    },
    {
      "hour": 6,
      "transactions": 4082,
      "fraud": 9
    },
    {
      "hour": 7,
      "transactions": 7233,
      "fraud": 23
    },
    {
      "hour": 8,
      "transactions": 10232,
      "fraud": 9
    },
    {
      "hour": 9,
      "transactions": 15767,
      "fraud": 16
    },
    {
      "hour": 10,
      "transactions": 16548,
      "fraud": 8
    },
    {
      "hour": 11,
      "transactions": 16781,
      "fraud": 53
    },
    {
      "hour": 12,
      "transactions": 15378,
      "fraud": 17
    },
    {
      "hour": 13,
      "transactions": 15323,
      "fraud": 17
    },
    {
      "hour": 14,
      "transactions": 16520,
      "fraud": 23
    },
    {
      "hour": 15,
      "transactions": 16374,
      "fraud": 26
    },
    {
      "hour": 16,
      "transactions": 16396,
      "fraud": 22
    },
    {
      "hour": 17,
      "transactions": 16130,
      "fraud": 28
    },
    {
      "hour": 18,
      "transactions": 16959,
      "fraud": 28
    },
    {
      "hour": 19,
      "transactions": 15566,
      "fraud": 19
    },
    {
      "hour": 20,
      "transactions": 16705,
      "fraud": 18
    },
    {
      "hour": 21,
      "transactions": 17629,
      "fraud": 16
    },
    {
      "hour": 22,
      "transactions": 15378,
      "fraud": 9
    },
    {
      "hour": 23,
      "transactions": 10883,
      "fraud": 17
    }
  ],
  "top_absolute_correlations_with_label": [
    {
      "feature": "V17",
      "abs_correlation": 0.3135
    },
    {
      "feature": "V14",
      "abs_correlation": 0.2934
    },
    {
      "feature": "V12",
      "abs_correlation": 0.2507
    },
    {
      "feature": "V10",
      "abs_correlation": 0.207
    },
    {
      "feature": "V16",
      "abs_correlation": 0.1872
    },
    {
      "feature": "V3",
      "abs_correlation": 0.1823
    },
    {
      "feature": "V7",
      "abs_correlation": 0.1723
    },
    {
      "feature": "V11",
      "abs_correlation": 0.1491
    },
    {
      "feature": "V4",
      "abs_correlation": 0.1293
    },
    {
      "feature": "V18",
      "abs_correlation": 0.1053
    }
  ],
  "split": {
    "split_method": "time_aware",
    "total_rows": 283726,
    "train_rows": 198608,
    "validation_rows": 42558,
    "test_rows": 42560,
    "train_time_range": [
      0.0,
      132906.0
    ],
    "validation_time_range": [
      132906.0,
      151320.0
    ],
    "test_time_range": [
      151320.0,
      172792.0
    ],
    "train_fraud": 366,
    "validation_fraud": 55,
    "test_fraud": 52
  },
  "missing_values": {}
};
export default DATASET_PROFILE;

