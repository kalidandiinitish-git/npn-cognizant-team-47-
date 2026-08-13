# Notebooks

Optional exploratory space. The reproducible EDA lives in the pipeline instead:
`src/training/train.py` writes `data/dataset_profile.json` on every run, covering

- class distribution and imbalance ratio,
- the cleaning report (duplicates, missing values, out-of-range rows),
- amount statistics overall and for fraud,
- transactions and fraud per hour of day,
- the ten features most correlated with the label,
- split sizes and fraud counts per split.

The dashboard reads that file on the Dataset page, so the analysis stays in sync
with the model rather than drifting inside a notebook.

To explore interactively:

```powershell
.\.venv\Scripts\python.exe -m pip install jupyterlab
.\.venv\Scripts\python.exe -m jupyterlab
```
