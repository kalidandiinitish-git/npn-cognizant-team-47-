# Edge functions

Empty on purpose. In the current design the Python engine owns scoring,
persistence and stream control, and the dashboard talks to it directly, so an
edge function would only add a hop.

Cases where one would be worth adding:

- **Alert notifications.** A database webhook on `fraud_alerts` insert calling a
  function that sends email or Slack for critical alerts.
- **Scheduled digests.** A cron function summarising the previous day's alerts.
- **Third-party enrichment.** Fetching device or geo reputation for an account,
  where the caller must not hold the vendor API key.

Anything on the per-transaction hot path belongs in the engine instead: the 50 ms
budget does not leave room for an extra network round trip.
