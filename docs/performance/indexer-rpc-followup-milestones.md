# Getter reuse and transport follow-up

This work extends the local performance branch. Checkpoint frequency, HyperSync ingestion and finite eRPC/provider protection remain unchanged. The [paired HyperSync replay](indexer-rpc-indexing-sample-2026-10-31.md) remains the recorded actual indexing comparison: 201.7 to 280.8 committed Ethereum blocks/second. The fixtures below answer narrower questions and must not be added to that replay's percentages.

## Viem retry scheduling and HTTP batching

The shared RPC boundary now uses viem's exported `withRetry` instead of a handwritten retry loop. The existing eight-active-operation guard, 256-waiter queue, six total proxy attempts, jittered exponential delay and sanitized exhaustion exception remain. Permits are released while waiting between attempts. eRPC retains upstream retry and aggregate rate ownership. Native HTTP and outer transport retry counts stay zero, so retry layers are not accidentally multiplied.

The classifier now recognizes JSON-RPC capacity codes 429 and -32007 alongside the existing proxy codes. A regression first failed on the raw JSON-RPC 429 response, then passed with the policy update. Historical-state failures and legitimate reverts remain terminal. Error-chain inspection checks that fixture credentials and private URLs do not escape exhaustion.

HTTP batching was already enabled and remains enabled with no extra collection delay. A partial batch regression proves that one capacity-limited item retries without resending its seven successful siblings. Forty cross-chain logical operations use at most ten HTTP envelopes while respecting eight in-flight operations.

| Three-run transport fixture | Unbatched | Existing batching |
| --- | ---: | ---: |
| RPC items per run | 128 | 128 |
| Concurrent RPC items | 8 | 8 |
| HTTP envelopes | 128 | 16 |
| Median duration | 230.523 ms | 218.896 ms |

This is 87.5% fewer indexer-to-proxy HTTP envelopes and about 5.0% shorter fixture time, at 10 ms of controlled latency per HTTP envelope. It does not reduce the 128 logical RPC operations or establish provider billing savings. Because batching was already enabled, these numbers demonstrate its existing benefit, not an incremental branch speedup from enabling it now. The retry refactor makes no separate throughput claim. Raw measurements: [HTTP batching artifact](indexer-rpc-http-batching-2026-10-31.json).

Run the fixture with the repository-pinned Node version:

```sh
cd apps/indexer
node --import ./scripts/register-typescript.mjs scripts/benchmark-http-batching.mjs
```

## Kernel reuse is database state

KernelReadCache and KernelReadEpoch are ordinary Envio database entities. They form a materialized cache in the database, persist across restarts and participate in event rollback. Replacing them with a process-global map would lose those properties. Persisted raw-call and deployment effects are separate: they survive rollback and therefore require block/deployment identity and fresh canonical acceptance checks.
