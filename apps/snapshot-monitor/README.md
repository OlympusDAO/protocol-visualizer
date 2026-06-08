# Snapshot Monitor

`snapshot-monitor` is a short-lived TypeScript cron job that reports protocol
visualizer indexing progress to Discord.

It reads the active bucket manifest, reads current Hasura progress per chain,
stores monitor state in the private bucket, and sends Discord messages for:

- one daily indexing summary;
- manifest handover detection;
- missing active manifest state;
- stale chain progress beyond the configured threshold.

The publisher also sends a Discord handover message immediately when it writes a
new active manifest.

## Configuration

Required production variables are uncommented; optional variables are commented.

Required production variables:

```bash
DISCORD_WEBHOOK_URL=<discord webhook url>
HASURA_GRAPHQL_URL=http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/graphql
HASURA_GRAPHQL_ADMIN_SECRET=${{hasura.HASURA_GRAPHQL_ADMIN_SECRET}}
BUCKET=${{<bucket-service>.BUCKET}}
ACCESS_KEY_ID=${{<bucket-service>.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{<bucket-service>.SECRET_ACCESS_KEY}}
REGION=${{<bucket-service>.REGION}}
ENDPOINT=${{<bucket-service>.ENDPOINT}}
```

Optional:

```bash
# INDEXER_DEPLOYMENT_ID=
# RAILWAY_GIT_COMMIT_SHA=
# MONITOR_STATE_KEY=v1/monitor-state.json
# MONITOR_STALE_CHAIN_HOURS=24
# PROTOCOL_CHAINS_CONFIG_PATH=/app/config/protocol-chains.json
```

Railway runs this service as a cron job with `restartPolicyType: NEVER`.
