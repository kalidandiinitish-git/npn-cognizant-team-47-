-- =====================================================================
-- FraudStream AI - demo seed data
--
-- Fictional rows so the dashboard has content before the first stream run.
-- Every identifier is prefixed with SEED so it is easy to remove:
--   see supabase/README.md for the cleanup statements.
--
-- Run after 0001_init.sql, with the service role (SQL editor is fine).
-- =====================================================================

insert into public.account_risk
  (account_id, transaction_count, suspicious_count, average_risk_score,
   maximum_risk_score, risk_score, risk_level, last_activity)
values
  ('ACC-SEED-0312', 6, 4, 0.612000, 0.973000, 0.940000, 'critical', now() - interval '4 minutes'),
  ('ACC-SEED-0184', 9, 2, 0.348000, 0.812000, 0.730000, 'high',     now() - interval '11 minutes'),
  ('ACC-SEED-0097', 14, 0, 0.121000, 0.290000, 0.180000, 'low',     now() - interval '18 minutes')
on conflict (account_id) do nothing;

insert into public.transactions
  (transaction_ref, sequence, account_id, card_last4, transaction_amount, merchant,
   merchant_category, location, channel, transaction_time, model_score, risk_score,
   risk_level, decision, is_fraud, inference_latency_ms, processing_latency_ms,
   actual_label, account_risk_level, behaviour)
values
  ('TXN-SEED-000001', 1, 'ACC-SEED-0097', '4417',   41.20, 'FreshMart',   'Grocery',
   'Berlin, DE',    'card_present', now() - interval '19 minutes', 0.008000, 0.061000,
   'low', 'Allow', false, 0.842, 0.961, 0, 'low',
   '{"account_transaction_count": 13, "transaction_velocity_1h": 2, "is_high_value": false}'::jsonb),

  ('TXN-SEED-000002', 2, 'ACC-SEED-0184', '9021',  128.50, 'PixelHub',    'Electronics',
   'London, GB',    'ecommerce',    now() - interval '12 minutes', 0.041000, 0.187000,
   'low', 'Allow', false, 0.911, 1.024, 0, 'high',
   '{"account_transaction_count": 7, "transaction_velocity_1h": 3, "is_high_value": false}'::jsonb),

  ('TXN-SEED-000003', 3, 'ACC-SEED-0312', '7734',  942.00, 'CoinGate X',  'Crypto Exchange',
   'Lagos, NG',     'ecommerce',    now() - interval '6 minutes',  0.512000, 0.884000,
   'high', 'Flag', true, 1.118, 1.286, 1, 'high',
   '{"account_transaction_count": 4, "transaction_velocity_1h": 5, "is_high_value": true}'::jsonb),

  ('TXN-SEED-000004', 4, 'ACC-SEED-0312', '7734', 1180.40, 'LedgerPeak',  'Crypto Exchange',
   'Singapore, SG', 'mobile_wallet', now() - interval '4 minutes', 0.913000, 0.973000,
   'critical', 'Alert and investigate', true, 1.041, 1.203, 1, 'critical',
   '{"account_transaction_count": 5, "transaction_velocity_1h": 6, "is_high_value": true}'::jsonb),

  ('TXN-SEED-000005', 5, 'ACC-SEED-0184', '9021',  305.75, 'SkyRoute Air', 'Travel',
   'Dubai, AE',     'ecommerce',    now() - interval '2 minutes',  0.184000, 0.512000,
   'medium', 'Monitor', false, 0.958, 1.087, 0, 'high',
   '{"account_transaction_count": 8, "transaction_velocity_1h": 4, "is_high_value": false}'::jsonb)
on conflict (transaction_ref) do nothing;

insert into public.fraud_alerts
  (transaction_id, account_id, risk_score, risk_level, alert_type, status,
   merchant, transaction_amount, location, created_at)
values
  ('TXN-SEED-000003', 'ACC-SEED-0312', 0.884000, 'high', 'high_value_anomaly', 'investigating',
   'CoinGate X', 942.00, 'Lagos, NG', now() - interval '6 minutes'),
  ('TXN-SEED-000004', 'ACC-SEED-0312', 0.973000, 'critical', 'critical_fraud_probability', 'open',
   'LedgerPeak', 1180.40, 'Singapore, SG', now() - interval '4 minutes');

insert into public.model_metrics
  (model_name, version, "precision", recall, f1_score, pr_auc, roc_auc,
   average_latency_ms, threshold)
values
  ('seed_example', '0.0.0', 0.750000, 0.750000, 0.750000, 0.762900, 0.973700, 0.974, 0.184200);
