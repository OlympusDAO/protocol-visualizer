# Local indexer RPC milestones

All work stays on the performance branch. Checkpoint frequency and HyperSync remain unchanged. No live variables, databases, deployments or PRs are changed.

## Comparable baseline

The recorded controlled PostgreSQL fixture runs 324 Ethereum relationship getter operations at block 17238767, a shared returned target, and 10 ms latency per RPC. Three serial repetitions use the pinned Envio loader with PostgreSQL-backed effect rows. The original baseline is 1944 requests and 31.660 s median. The first committed bytecode optimization is 1361 requests and 22.37 s median. Results and restart persistence match. This is not a full replay or live billing measurement. eRPC already absorbs duplicate upstream requests.

| Milestone | Requests in original fixture | Median | Change from original baseline |
| --- | ---: | ---: | --- |
| Recorded baseline | 1944 | 31.660 s | — |
| Persisted block bytecode facts (existing commit) | 1361 | 22.37 s | 30.0% fewer requests; 29.3% shorter |
| Shared proxy recovery and exact calls | 1361 | 22.362 s | 30.0% fewer requests; 29.4% shorter |

## Shared proxy recovery and exact calls

One process-wide FIFO queue admits eight logical RPC requests at a time and at most 256 waiters, across all chains. Six total attempts retry transient capacity/transport failures with bounded exponential jitter (250 ms to 4 s base delay). Permits are released during waits. Every retry uses the same configured proxy; upstream retries remain eRPC-owned. Exhaustion throws a sanitized identifiable exception through getter, bytecode, metadata, header, dependency, and optional router catch boundaries. It prevents successful incomplete observations. A prolonged outage can still stop Envio after the bounded budget; in-process recovery is for short outages, not infinite availability.

Raw successful canonical eth_call requests persist as Envio effects. The key includes chain and the complete wire parameters: destination, full calldata, caller, gas/value/options, state overrides and canonical block hash. ABI/field names do not affect identity. Consumers decode independently. Errors, latest calls and numeric-height calls do not persist. Mutable numeric-height headers remain uncached. Existing effect limits and Etherscan metadata limits remain.

The raw-call regression measures two independently decoded consumers becoming one RPC, including reload through a fresh Envio runtime. Key-isolation cases and non-caching of errors/latest/numeric heights pass. The original 324-operation workload contains no duplicate calldata, so this milestone adds no request reduction to that fixture. Do not extrapolate the 50% duplicate-consumer reduction to total indexing.

Verification: 71 indexer tests passed; indexer TypeScript check passed. The PostgreSQL fixture used a new disposable tmpfs container, without resetting an existing database. Three result digests match the baseline and restart adds zero fixture RPC requests. Raw measurement: [milestone 1](indexer-rpc-milestone-1.json). The final required nine-step repository sequence is still pending.

## Remaining milestones

- Event-invalidated active Kernel/module pointer and dependency reuse, retaining original RPC provenance and inactive-policy fallback.
- Narrow source/runtime-proven deployment lifetime and immutable getter facts.
- Last: aggregate eRPC budget, private revert compatibility and actual proxy/PostgreSQL integration. Keep finite defaults and provider protection.

Worker isolation is not an environment-only toggle in Envio 3.14.1: all current entities use shared cross-chain storage. Enabling per-chain processing changes storage keys and checkpoint sequencing and requires a migration/replay plan. This task does not reset databases or activate workers. HyperSync rate limits already wait/retry their source query; custom RPC effects need the separate recovery boundary implemented above.
