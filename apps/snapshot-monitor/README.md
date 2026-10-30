# Snapshot Monitor

`snapshot-monitor` is a short-lived TypeScript cron job that sends a daily
heartbeat confirming that the protocol visualizer indexer is reachable and not
stale.

It reads the active bucket manifest, reads current Envio metrics per chain,
stores monitor state in the private bucket, and sends Discord messages for:

- daily indexing summaries for production chains and testnets;
- missing active manifest state;
- stale chain progress beyond the configured threshold.

The monitor treats Envio `/metrics` as the indexing source of truth. Per-chain
`date` and `timestamp` values describe the Envio progress block. When Envio
omits its timestamp, the monitor looks up that exact block using
`RPC_URL_<chainId>`. Failed lookups show
`Timestamp unavailable`. Stalled-chain warnings compare block advancement
across monitor runs.

Each configured chain occupies one full-width field. Orange means behind head,
green means synced, and gray means progress or readiness is unavailable.
The group border is orange when any chain is behind, green when all are synced,
and gray otherwise. Missing metrics never count as synced.
Separate “not synced to head” warnings are replaced by these status rows.
Extra runs while chains are unready refresh the grouped summaries.
Grouping follows the catalog's `environment` property, which must be
`production` or `testnet` for every indexed chain. Historical chains are excluded.

Deployment lifecycle messages, including new deployment detection, hourly
pre-handover progress, and completed handovers, belong in `snapshot-publisher`.

See [Discord notification examples](../../docs/discord-notifications.md) for
daily summaries, warnings, publisher messages, and field limits.

## Configuration

Required production variables are uncommented; optional variables are commented.

Required production variables:

```bash
DISCORD_WEBHOOK_URL=${{shared.DISCORD_WEBHOOK_URL}}
RAILWAY_ENVIRONMENT_NAME=<provided by Railway>
INDEXER_METRICS_URL=http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:9898/metrics
BUCKET=${{<bucket-service>.BUCKET}}
ACCESS_KEY_ID=${{<bucket-service>.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{<bucket-service>.SECRET_ACCESS_KEY}}
REGION=${{<bucket-service>.REGION}}
ENDPOINT=${{<bucket-service>.ENDPOINT}}
```

IaC supplies the shared webhook reference. Add its value once per environment
in Railway Project Settings → Shared Variables.

The indexer Railway service must expose the same port used in
`INDEXER_METRICS_URL`. With the documented setup, set `indexer.PORT=9898` so the
monitor can reach `http://indexer.railway.internal:9898/metrics`.
`RAILWAY_ENVIRONMENT_NAME` is provided automatically by Railway and is required;
the monitor fails before metrics reads or bucket writes if it is missing.

Set `RPC_URL_<chainId>` for every indexed chain in the chain catalog.
Keep credential-bearing URLs in server
environment variables. No built-in public RPC endpoints are used.
Railway runs `node dist/src/index.js --check-config` before deployment. Missing
or blank required RPC variables fail that check and stop deployment. The monitor
also checks on startup. Docker image builds do not require RPC credentials.

Optional:

```bash
# INDEXER_DEPLOYMENT_ID=
# RAILWAY_GIT_COMMIT_SHA=
# MONITOR_STATE_KEY=v1/monitor-state.json
# MONITOR_STALE_CHAIN_HOURS=24
# PROTOCOL_CHAINS_CONFIG_PATH=/app/config/protocol-chains.json
```

Railway runs this service as a cron job with `restartPolicyType: NEVER`.
