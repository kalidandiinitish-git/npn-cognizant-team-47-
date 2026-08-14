import React, { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/app/AppShell';
import { Banner, Card, CardHeader, DefinitionRow, EmptyState, Spinner, StatTile } from '../components/ui';
import { Icon } from '../components/Icons';
import { HourlyDistributionChart } from '../components/app/widgets';
import { useStream } from '../context/StreamContext';
import useDocumentTitle from '../hooks/useDocumentTitle';
import api from '../services/api';
import { API_ENDPOINTS, MAX_UPLOAD_MB, SUPPORTED_UPLOAD_TYPES } from '../utils/constants';
import { formatBytes, formatCurrency, formatNumber, formatScore } from '../utils/format';

export default function Dataset() {
  useDocumentTitle('Dataset and stream');
  const { dataset, health, streamStatus, refreshReference, startStream, busy } = useStream();

  useEffect(() => {
    if (refreshReference) refreshReference();
  }, [refreshReference]);

  const fileInput = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState(null);

  const profile = dataset && dataset.profile ? dataset.profile : null;
  const cleaning = profile ? profile.cleaning || {} : {};
  const distribution = profile ? profile.class_distribution || {} : {};
  const amount = profile ? profile.amount || {} : {};
  const split = profile ? profile.split || {} : {};
  const trainingDataset = (dataset && dataset.training_dataset) || {};
  const streamSource = (dataset && dataset.stream_source) || {};

  const onUpload = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    setUploadError(null);
    setUploadResult(null);

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setUploadError('Only .csv files are accepted.');
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setUploadError(`That file is larger than the ${MAX_UPLOAD_MB} MB limit.`);
      return;
    }

    setUploading(true);
    try {
      const result = await api.uploadDataset(file);
      setUploadResult(result);
      await refreshReference();
    } catch (error) {
      setUploadError(error.message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const streamUploaded = async (name) => {
    setUploadError(null);
    try {
      if (isRunning) {
        await stopStream();
      }
      await startStream({ source: name, delay_ms: 80, limit: 2000, persist: true, reset: true });
      await refreshReference();
    } catch (error) {
      setUploadError(error.message);
    }
  };

  return (
    <>
      <PageHeader
        title="Dataset and stream"
        subtitle="What the model was trained on, what the generator is replaying, and how to load your own file."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Transactions"
          value={profile ? formatNumber(profile.rows) : '--'}
          hint={profile && cleaning.duplicates_removed ? `${formatNumber(cleaning.duplicates_removed)} duplicates removed` : null}
          icon="database"
        />
        <StatTile
          label="Confirmed frauds"
          value={profile && distribution.fraud != null ? formatNumber(distribution.fraud) : '--'}
          hint={profile && distribution.fraud_percentage ? `${distribution.fraud_percentage}% of all rows` : null}
          icon="alert"
        />
        <StatTile
          label="Imbalance"
          value={profile && distribution.negative_to_positive_ratio ? `1 : ${formatNumber(Math.round(distribution.negative_to_positive_ratio || 0))}` : '--'}
          hint="legitimate to fraud"
          icon="target"
        />
        <StatTile
          label="Stream source rows"
          value={streamSource.rows != null ? formatNumber(streamSource.rows) : '--'}
          hint={streamSource.name || null}
          icon="stream"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title="Active files" subtitle="Resolved by the engine at startup" icon="file" />
          <div className="px-5 py-4">
            {dataset ? (
              <dl>
                <DefinitionRow label="Training dataset" mono>
                  {trainingDataset.name || 'creditcard.csv'}
                </DefinitionRow>
                <DefinitionRow label="Size">
                  {formatBytes(trainingDataset.size_bytes || 0)}
                </DefinitionRow>
                <DefinitionRow label="Stream source" mono>
                  {streamSource.name || 'stream_test.csv'}
                </DefinitionRow>
                <DefinitionRow label="Stream rows">
                  {formatNumber(streamSource.rows || 0)}
                </DefinitionRow>
                <DefinitionRow label="Model loaded">
                  {health && health.model_loaded ? health.model_name : 'xgboost'}
                </DefinitionRow>
                <DefinitionRow label="Supabase">
                  {health && health.supabase_configured ? 'connected' : 'not configured'}
                </DefinitionRow>
              </dl>
            ) : (
              <EmptyState icon="file" title="Dataset information unavailable" description="The engine did not return dataset details." />
            )}

            <div className="mt-4 rounded-md border border-hairline bg-paper p-3.5">
              <p className="text-[12.5px] leading-relaxed text-ink-600">
                {streamSource.name && streamSource.name !== 'stream_test.csv' ? (
                  <>
                    Currently streaming from uploaded dataset <span className="mono font-semibold text-brand-600">{streamSource.name}</span> ({formatNumber(streamSource.rows || 0)} transactions).
                  </>
                ) : (
                  <>
                    The default stream replays <span className="mono">stream_test.csv</span>, the held-out test split. You can also upload custom CSV datasets below and replay them directly.
                  </>
                )}
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Load a dataset" subtitle="CSV with Time, V1-V28, Amount and optional Class" icon="upload" />
          <div className="px-5 py-4">
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-hairline bg-paper px-6 py-8 text-center transition-colors hover:border-brand-300 hover:bg-brand-50/40"
              htmlFor="dataset-upload"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-md border border-hairline bg-white text-brand-500">
                {uploading ? <Spinner className="h-4 w-4" /> : <Icon name="upload" className="h-4 w-4" />}
              </span>
              <span className="text-[13.5px] font-semibold text-ink-900">
                {uploading ? 'Uploading and parsing dataset...' : 'Choose a CSV file'}
              </span>
              <span className="text-2xs text-ink-500">Up to {MAX_UPLOAD_MB} MB</span>
              <input
                ref={fileInput}
                id="dataset-upload"
                type="file"
                accept={SUPPORTED_UPLOAD_TYPES}
                className="sr-only"
                onChange={onUpload}
                disabled={uploading}
              />
            </label>

            {uploadError ? (
              <div className="mt-3">
                <Banner tone="error">{uploadError}</Banner>
              </div>
            ) : null}

            {uploadResult ? (
              <div className="mt-3">
                <Banner tone="success" title={`${uploadResult.name} ready`}>
                  Parsed {formatNumber(uploadResult.rows)} transactions ({formatBytes(uploadResult.size_bytes)}). Ready to stream live!
                </Banner>
              </div>
            ) : null}

            {dataset && dataset.uploads && dataset.uploads.length ? (
              <div className="mt-4">
                <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">Uploaded datasets</p>
                <ul className="mt-2 divide-y divide-hairline border-t border-hairline">
                  {dataset.uploads.map((upload) => {
                    const isStreamingThis = isRunning && (streamSource.name === upload.name);
                    return (
                      <li key={upload.name} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="mono truncate text-ink-900 font-medium">{upload.name}</p>
                          <p className="text-2xs text-ink-500">
                            {formatNumber(upload.rows || 0)} rows • {formatBytes(upload.size_bytes || 0)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {isStreamingThis ? (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-2xs font-medium text-emerald-700">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                              Streaming
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className={isStreamingThis ? "btn-danger btn-sm" : "btn-primary btn-sm"}
                            onClick={() => isStreamingThis ? stopStream() : streamUploaded(upload.name)}
                            disabled={busy}
                          >
                            <Icon name={isStreamingThis ? "stop" : "play"} className="h-3.5 w-3.5" />
                            {isStreamingThis ? 'Stop' : 'Stream this'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <p className="mt-4 text-2xs leading-relaxed text-ink-500">
              Uploads land in <span className="mono">ml-engine/data/uploads</span>. To train on a new
              file, point <span className="mono">DATA_PATH</span> at it and re-run the training
              command.
            </p>
          </div>
        </Card>
      </div>

      {profile ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader
              title="Transactions by hour"
              subtitle="Fraud concentrates in the quiet hours, which is why hour of day is a feature"
              icon="chart"
            />
            <HourlyDistributionChart hourly={profile.hourly_distribution} />
          </Card>

          <Card>
            <CardHeader title="Cleaning and split" subtitle="Applied before training" icon="filter" />
            <div className="px-5 py-4">
              <dl>
                <DefinitionRow label="Rows read">{formatNumber(cleaning.rows_in)}</DefinitionRow>
                <DefinitionRow label="Duplicates removed">
                  {formatNumber(cleaning.duplicates_removed)}
                </DefinitionRow>
                <DefinitionRow label="Missing values dropped">
                  {formatNumber(cleaning.rows_with_missing_values_dropped)}
                </DefinitionRow>
                <DefinitionRow label="Out of range dropped">
                  {formatNumber(cleaning.out_of_range_rows_dropped)}
                </DefinitionRow>
                <DefinitionRow label="Rows kept">{formatNumber(cleaning.rows_out)}</DefinitionRow>
                <DefinitionRow label="Train / validation / test">
                  {formatNumber(split.train_rows)} / {formatNumber(split.validation_rows)} /{' '}
                  {formatNumber(split.test_rows)}
                </DefinitionRow>
                <DefinitionRow label="Mean amount">{formatCurrency(amount.mean)}</DefinitionRow>
                <DefinitionRow label="Mean fraud amount">
                  {formatCurrency(amount.fraud_mean)}
                </DefinitionRow>
                <DefinitionRow label="Largest amount">{formatCurrency(amount.max)}</DefinitionRow>
              </dl>
            </div>
          </Card>
        </div>
      ) : null}

      {profile && profile.top_absolute_correlations_with_label ? (
        <div className="mt-4">
          <Card>
            <CardHeader
              title="Strongest signals in the data"
              subtitle="Absolute correlation with the fraud label, computed on the clean dataset"
              icon="chart"
            />
            <ul className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-5">
              {profile.top_absolute_correlations_with_label.slice(0, 10).map((entry) => (
                <li key={entry.feature} className="bg-white px-4 py-3">
                  <p className="mono text-ink-900">{entry.feature}</p>
                  <p className="tabular mt-1 text-[15px] font-semibold text-ink-900">
                    {formatScore(entry.abs_correlation, 3)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <div className="mt-4">
        <Card>
          <CardHeader title="Engine API" subtitle="What this dashboard is calling" icon="code" />
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr>
                  <th className="th">Method</th>
                  <th className="th">Path</th>
                  <th className="th">Purpose</th>
                </tr>
              </thead>
              <tbody>
                {API_ENDPOINTS.map((endpoint) => (
                  <tr key={endpoint.path}>
                    <td className="td">
                      <span
                        className={`mono rounded px-1.5 py-0.5 ${
                          endpoint.method === 'GET'
                            ? 'bg-sky-50 text-sky-700'
                            : 'bg-brand-50 text-brand-700'
                        }`}
                      >
                        {endpoint.method}
                      </span>
                    </td>
                    <td className="td mono text-ink-900">{endpoint.path}</td>
                    <td className="td text-ink-600">{endpoint.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {streamStatus ? (
            <div className="border-t border-hairline bg-paper px-5 py-3 text-[12.5px] text-ink-600">
              Current stream state: <span className="font-semibold">{streamStatus.status}</span>
              {streamStatus.error ? ` - ${streamStatus.error}` : ''}
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
