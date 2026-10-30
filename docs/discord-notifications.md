# Discord notification examples

The publisher sends deployment progress and snapshot handover notifications.
The monitor sends daily summaries and warnings about indexing or snapshot state.
Both services use the environment's shared `DISCORD_WEBHOOK_URL` in Railway.
The publisher treats notifications as optional. The monitor requires the webhook.

These examples use fictional values and show all nine currently indexed chains.
The monitor includes all nine configured chains, including rows with unavailable progress.
Publisher notifications include every chain with available progress.
Monitor chain fields occupy a full row. Discord can arrange publisher fields in columns.
Deployment IDs use at most 12 characters in notifications.

`<t:1700000000:F>` is Discord timestamp markup. Discord displays it in the reader's local time zone.
Each chain's `Time` describes its indexed progress block, not the notification time.
When the block timestamp is unavailable, that line reads `Time: Timestamp unavailable`.

## Monitor: daily indexing summary

The monitor sends two notifications: production chains and testnets. Groups follow the chain catalog, independent of the Railway environment.
The saved state limits the daily summary to once per UTC day. Extra runs while chains are unready send updated grouped summaries.
An active manifest adds the footer shown below.

Each chain occupies one full-width field. Its indicator and `Status` line replace the separate “not synced to head” warnings.
Discord supports color on the whole embed border, rather than individual fields.
A group has an orange border when any chain is behind, green when all are synced, and gray otherwise.

| Indicator | Status |
| --- | --- |
| 🟠 | Behind head, according to Envio readiness metrics |
| 🟢 | Synced to head, according to Envio readiness metrics |
| ⚪ | Progress or readiness unavailable; never inferred as synced |

Missing metrics show `Block: Unavailable` and `Time: Timestamp unavailable`.
A missing timestamp alone does not change the readiness status.

```text
Protocol visualizer indexing summary — Production chains

Protocol Visualizer Indexing Summary — Production chains
Environment protocol-visualizer-pr-123

Deployment ID
abcdef123456

🟠 Ethereum Mainnet
Status: Behind head
Block: 16000000
Time: <t:1700000000:F>

🟢 Optimism
Status: Synced to head
Block: 100000000
Time: <t:1700000000:F>

🟠 Arbitrum
Status: Behind head
Block: 150000000
Time: <t:1700000000:F>

🟢 Base
Status: Synced to head
Block: 10000000
Time: <t:1700000000:F>

🟢 Berachain
Status: Synced to head
Block: 5000000
Time: <t:1700000000:F>

🟢 Robinhood Chain
Status: Synced to head
Block: 12000000
Time: <t:1700000000:F>

Active manifest: 2026-10-30T00:00:00.000Z
```

```text
Protocol visualizer indexing summary — Testnets

Protocol Visualizer Indexing Summary — Testnets
Environment protocol-visualizer-pr-123

Deployment ID
abcdef123456

🟢 Sepolia
Status: Synced to head
Block: 7000000
Time: <t:1700000000:F>

🟢 Arbitrum Sepolia
Status: Synced to head
Block: 280000000
Time: <t:1700000000:F>

🟢 Base Sepolia
Status: Synced to head
Block: 25000000
Time: <t:1700000000:F>

Active manifest: 2026-10-30T00:00:00.000Z
```

## Monitor: warnings

These are separate plain-text messages. More than one warning can accompany a daily summary.

### No active manifest

This warning can occur before the first snapshot publication completes.

```text
Protocol visualizer snapshot monitor: no active manifest is published for deployment abcdef123456.
```

### Old active snapshots

This warning uses the manifest generation time and the configured stale threshold.

```text
Protocol visualizer snapshot warning: active snapshots are 25h old. Active manifest was generated at 2026-10-29T00:00:00.000Z.
```

### Chain stopped advancing

The monitor compares processed blocks across runs. The default stale threshold is 24 hours, controlled by `MONITOR_STALE_CHAIN_HOURS`.

```text
Protocol visualizer indexing warning: Mainnet has not advanced since 2026-10-29T00:00:00.000Z at block 16000000.
```

## Publisher: new deployment indexing

The publisher sends this notification on its first observation of an unready deployment.
The previous manifest remains active during backfill. With no active manifest, `Published deployment` reads `<none>` and the footer is absent.

```text
Protocol visualizer new deployment indexing

Protocol Visualizer New Deployment Indexing
Environment protocol-visualizer-pr-123

Indexing deployment
abcdef123456

Published deployment
0123456789ab

Synced to head
no

Decision reasons
indexer_not_synced_to_head, chains_not_ready, active_manifest_is_previous_deployment, indexing_deployment_first_seen

Mainnet
Block: 16000000
Time: <t:1700000000:F>

Optimism
Block: 100000000
Time: <t:1700000000:F>

Arbitrum
Block: 150000000
Time: <t:1700000000:F>

Base
Block: 10000000
Time: <t:1700000000:F>

Berachain
Block: 5000000
Time: <t:1700000000:F>

Robinhood
Block: 12000000
Time: <t:1700000000:F>

Sepolia
Block: 7000000
Time: <t:1700000000:F>

ArbitrumSepolia
Block: 280000000
Time: <t:1700000000:F>

BaseSepolia
Block: 25000000
Time: <t:1700000000:F>

Active manifest: 2026-10-30T00:00:00.000Z
```

The decision reasons reflect the actual readiness and deployment state.
For example, missing chain metrics add `missing_chain_metrics`.

## Publisher: indexing continues

Later publisher runs use the same fields while that deployment remains unready.
The message and embed title change to:

```text
Protocol visualizer indexing continues

Protocol Visualizer Indexing Continues
```

The decision reasons include `indexing_deployment_seen_before` instead of the first-observation reason.
The publisher updates the per-chain blocks and timestamps on each run.

## Publisher: snapshot handover completed

The publisher sends this notification after it publishes the first active manifest or replaces one from another deployment.
It uploads and verifies the chain artifacts before it publishes the manifest.
Routine refreshes of the same deployment do not send another handover notification.

```text
Protocol visualizer snapshot handover completed

Protocol Visualizer Snapshot Handover
Environment protocol-visualizer-pr-123

Deployment ID
abcdef123456

Ethereum Mainnet
Block: 16000000
Time: <t:1700000000:F>

Optimism
Block: 100000000
Time: <t:1700000000:F>

Arbitrum
Block: 150000000
Time: <t:1700000000:F>

Base
Block: 10000000
Time: <t:1700000000:F>

Berachain
Block: 5000000
Time: <t:1700000000:F>

Robinhood Chain
Block: 12000000
Time: <t:1700000000:F>

Sepolia
Block: 7000000
Time: <t:1700000000:F>

Arbitrum Sepolia
Block: 280000000
Time: <t:1700000000:F>

Base Sepolia
Block: 25000000
Time: <t:1700000000:F>
```

Handover notifications use the chain display names from the manifest.
The monitor uses catalog display names, such as `Ethereum Mainnet`.
Publisher progress notifications use progress keys, such as `Mainnet`.

## Field limits and delivery errors

Each chain uses one field with its block and timestamp. No chain is removed to fit the field limit.

| Notification | Fields with nine chains |
| --- | ---: |
| Monitor production summary | 7: deployment ID plus six chains |
| Monitor testnet summary | 4: deployment ID plus three chains |
| Publisher handover | 10: deployment ID plus nine chains |
| Publisher indexing progress | 13: four metadata fields plus nine chains |

Both senders reject an embed with more than 25 fields before any HTTP request.
Exactly 25 fields per embed are allowed. An oversized embed raises `Discord embeds must have at most 25 fields`.

The monitor fails its run on a delivery error.
The publisher logs notification errors and continues its normal publication or readiness-skip behavior.
A missing webhook skips publisher notifications.

See [Railway shared variables](railway-self-hosting.md#automatic-variables-and-manual-secrets) for webhook configuration.
