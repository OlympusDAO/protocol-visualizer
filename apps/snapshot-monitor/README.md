# Snapshot Monitor

`snapshot-monitor` is a short-lived TypeScript cron job that reports protocol
visualizer indexing progress to Discord.

It reads the active bucket manifest, reads current Envio metrics per chain,
stores monitor state in the private bucket, and sends Discord messages for:

- one daily indexing summary;
- manifest handover detection;
- missing active manifest state;
- stale chain progress beyond the configured threshold.

The monitor treats Envio `/metrics` as the indexing source of truth. Per-chain
`date` and `timestamp` values are observation times, while `block` is the Envio
progress block. Stalled-chain warnings compare block advancement across monitor
runs.

The publisher also sends a Discord handover message immediately when it writes a
new active manifest.

## Configuration

Required production variables are uncommented; optional variables are commented.

Required production variables:

```bash
DISCORD_WEBHOOK_URL=<discord webhook url>
INDEXER_METRICS_URL=http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:9898/metrics
BUCKET=${{<bucket-service>.BUCKET}}
ACCESS_KEY_ID=${{<bucket-service>.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{<bucket-service>.SECRET_ACCESS_KEY}}
REGION=${{<bucket-service>.REGION}}
ENDPOINT=${{<bucket-service>.ENDPOINT}}
```

The indexer Railway service must expose the same port used in
`INDEXER_METRICS_URL`. With the documented setup, set `indexer.PORT=9898` so the
monitor can reach `http://indexer.railway.internal:9898/metrics`.

Optional:

```bash
# INDEXER_DEPLOYMENT_ID=
# RAILWAY_GIT_COMMIT_SHA=
# MONITOR_STATE_KEY=v1/monitor-state.json
# MONITOR_STALE_CHAIN_HOURS=24
# PROTOCOL_CHAINS_CONFIG_PATH=/app/config/protocol-chains.json
```

Railway runs this service as a cron job with `restartPolicyType: NEVER`.
