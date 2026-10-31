# Local HyperSync indexing comparison

The candidate processed the same 50,001 Ethereum blocks **39.2% faster**, with **54.0% fewer upstream RPC requests**. It also recovered 81 relationship verifications that the baseline left unavailable. This is one paired local replay with real HyperSync events and configured upstream RPCs, not a production or nine-chain speed claim.

| Measure | Baseline | Candidate |
| --- | ---: | ---: |
| Time from process launch to observed committed completion | 247.903 s | 178.070 s |
| Committed blocks per second | 201.696 | 280.795 |
| Committed events and block-handler items | 523 | 523 |
| Requests received by eRPC | 19,155 | 22,084 |
| Actual upstream RPC requests, including pollers | 9,534 | 4,381 |
| Upstream bytecode reads | 5,733 | 790 |
| Upstream contract calls | 3,627 | 3,426 |
| Local eRPC budget rejection counter | 558 | 12 |
| Matching relationship verifications at completion | 496 | 577 |
| Historical getter verifications left unavailable | 81 | 0 |
| Expected pending-owner gaps without a public getter | 2 | 2 |

Both databases committed through block 26,290,000 and reported ready. Both processes exited successfully. Candidate time was 28.2% shorter; throughput was 1.392 times baseline. The 496 relationships available in both runs had identical kind, source, target, status, subject, getter and value fields. No available relationship became unavailable. The 81 recovered relationships account for the higher match count; verification provenance intentionally differs between cache reuse and fresh observations.

An independent check then read all 81 recovered getters at the final block using the baseline production reader, bypassing indexer effects and deployment caches. All 81 values matched, with no differences. The check used the contract address encoded in each relationship ID, rather than the directional relationship source, and the final block hash rather than older verification provenance. This also checked the reused immutable value against current historical state.

## What the result explains

The largest observed request reduction was bytecode: 5,733 upstream reads became 790, an 86.2% reduction. The shared bytecode facts remove repeated reads across consumers. Exact-call sharing, deployment facts and event-invalidated reuse also participate, but this combined replay does not isolate their individual timing contributions. The candidate persisted 788 bytecode facts and ten Kernel cache entities in the actual Envio database.

Fresh canonical checks increased indexer-to-proxy traffic by 15.3%. Header requests rose from 9,260 to 17,856, but eRPC served 17,848 candidate header requests from cache. Total upstream traffic still fell by 5,153 requests. This is why indexer request counts and provider request counts must be measured separately.

The candidate encountered 12 rejected proxy requests and recovered without stopping or leaving historical getter gaps. Baseline lacked client recovery and completed with 81 such gaps. Upstream outcome counters reported successes, empty responses and legitimate execution reverts; no provider throttling/error outcome was recorded. Local budget rejection counters are not Alchemy 429 counts. This sample does not establish that provider throttling is impossible.

## Method and comparison limits

- Indexer baseline: `9eb4755be2904f6751a72890ecce134c4c701fef`; candidate: `f461ee018f53af81f07826ad11e63af7f9d18e78`.
- Ethereum range: 26,240,000 through 26,290,000 inclusive. Historical checkpoints remain every 10,000 blocks, plus the existing seed/end handlers. Both runs committed 523 events and block-handler items.
- Immutable source exports ran sequentially using Node 24.22.1 and Envio 3.14.1. Each used a new database and an empty, separate eRPC cache database in a fresh local PostgreSQL 17 container. No existing database was reset.
- Both used the same patched eRPC image and aggregate 50-request/second budget, so the replay compares indexer code while holding proxy behavior fixed. It does not isolate the eRPC configuration change against the old per-method budget.
- Scratch configurations selected Ethereum, set the bounded start/end, clamped earlier contract start blocks to the sample start as Envio requires, and selected RPC `fallback` mode. HyperSync remained the event source. Baseline and candidate configuration SHA-256 hashes are identical in the raw artifact. Repository configurations and the original worktree were unchanged.
- Hasura was disabled for both local runs. The native local processes did not have the production one-vCPU resource cap. Live upstream conditions, sequential ordering and cache warmth outside these isolated databases can affect timing.
- Completion was observed from the database `_meta` view approximately every two seconds. Elapsed time includes process startup, initial seeding and committed completion. All progress was committed in one batch; fetched progress alone was not counted as completion.
- This truncated replay skips prior event history. It exercises actual handlers, two Kernel actions, fresh entity storage and ten reusable Kernel facts, but does not prove full historical replay, existing-database migration, or real Envio rollback restoration.
- Baseline's incomplete verifications mean the runs do not have identical full results. Candidate improves completeness as well as throughput; this is not an equal-output latency benchmark. The earlier controlled reader fixtures remain separate evidence.

The October 30 live baseline used a different multichain range, resource allocation and scheduling window. Its Ethereum committed progress was zero during that window. Dividing this local result by that zero would be invalid; the paired local baseline above provides the meaningful rate comparison.

Raw counters, progress samples, semantic comparison and provenance are in [the sample artifact](indexer-rpc-indexing-sample-2026-10-31.json).

## Recovery and rate-budget meaning

The indexer permits eight active RPC operations and 256 queued waiters per process. A transient failure gets up to six total proxy attempts. Retry delays have exponential bases of 250, 500, 1,000, 2,000 and 4,000 milliseconds, each with 25% jitter; total delay is about 5.8–9.7 seconds plus request time. A waiting retry releases its active permit. Exhaustion or queue overflow raises a sanitized identifiable failure; incomplete observations cannot be committed as successful checkpoints. A prolonged outage can still stop Envio. This is bounded recovery, not unlimited retry or guaranteed uninterrupted indexing.

The eRPC default is one shared pool of 50 unit credits per fixed one-second window, across methods and networks in that proxy process. Every upstream admission spends one credit; cache hits do not. Network retries reacquire credits, upstream maxAttempts stays one, and no hedging is enabled. The limiter rejects excess work rather than queueing it; the indexer supplies bounded queueing and recovery. No live RPS or Envio effect limit was raised.

Alchemy instead enforces account-wide compute-unit throughput over a rolling ten-second window. Published costs include 26 CU for `eth_call` and 20 CU for code/header reads. Fifty calls per second can therefore cost 1,300 CU/second, before other apps consume any quota. A 50-RPS proxy limit alone cannot guarantee compliance with an unknown account quota, and multiple proxy instances have separate local pools. Fixed-window bursts also differ from Alchemy's limiter. See [Alchemy throughput](https://www.alchemy.com/docs/reference/throughput) and [method costs](https://www.alchemy.com/docs/reference/compute-unit-costs).

Keep the finite cap until the actual account quota, method mix, other account traffic and replica count are known. A later increase should reserve account headroom and use throughput-CU weights or a conservative request cap. The cache savings reduce pressure now; lifting RPS or enabling workers is not needed to obtain this measured improvement.

## Local validation

All nine repository-required commands passed in order after this sample: runtime versions, frozen install, lint, build, local snapshot generation, then indexer, frontend, snapshot-gateway and snapshot-publisher image builds. The build includes 79 passing indexer tests. The paired replay and independent fresh-value check are additional runtime evidence. The original worktree remained clean at its supplied base commit. No push, PR update, deployment, existing database reset or live variable change occurred.
