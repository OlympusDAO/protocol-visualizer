# Native Envio worker experiment

This branch starts from the RPC-read performance branch at `ac5eab8`. It tests Envio 3.14.1's built-in supervisor on fresh local databases. No preview or production storage has been migrated.

## Storage milestone

All 20 entities use Envio's native per-chain storage. Envio supplies the physical `chainId` column, partitions and composite identity. Handlers no longer supply or filter that column. Existing chain-prefixed IDs and external snapshot fields remain unchanged.

Deployment reuse now validates the handler's chain scope rather than expecting a physical database column in the loaded entity. Ownership presentation receives the chain explicitly. Dependency and discovered-pool queries use the handler's native scope and reject a conflicting explicit chain argument.

All 15 existing effects explicitly retain shared scope. Their inputs already include chain identity; this preserves their cache table identity and avoids accidentally multiplying effect limits within one process.

Metadata HTTP admission is separate from RPC admission. Etherscan and Sourcify each retain five starts/second in an ordinary process. Native workers reserve one start/second each; the unique worker assigned Ethereum receives a second start/second. Across Envio's pinned maximum of four workers this uses at most five starts/second. Unrecognized worker metadata retains the one-slot share. Admission measures from actual release so overdue timers cannot bunch up after a stall. Retries reacquire admission. This protection assumes one supervisor, not multiple replicas.

This schema change requires a fresh database/reindex. Do not point it at an existing shared-schema database or apply ad hoc DDL. Default PostgreSQL connection capacity remains unchanged, so this milestone alone does not enable multiple workers in deployment.

## Correctness evidence

The deployment reload regression first failed because a native entity lacks `chainId`; it now reuses the fact without entering effects and rejects wrong-chain access. Focused deployment, Kernel and ownership tests passed (30 tests).

The real PostgreSQL fixture seeds two chains with identical deployment, Kernel, dependency, module and registration IDs. Separate processes reload, roll back only chain 1, persist the replacement checkpoint and reload again. It checks native `get`/`getWhere` isolation, all three production query paths, pending-owner restoration, the unaffected chain, retained verification provenance and cache hits after restart. It creates its own database; existing databases are untouched.

## Measurement protocol

No worker speedup is claimed from single-chain tests. The previous Robinhood comparison (+142.7% throughput) measures earlier RPC optimizations, not this change.

Compare one, two and four native processing groups on identical four-chain HyperSync ranges, fresh indexer/cache databases and the same aggregate 50 unit-credit/second eRPC cap. Keep 10,000-block checkpoint and 100-block realtime observation intervals unchanged. Require all chains to finish, equal per-chain event counts and canonical entity digests before accepting a speed percentage.

Envio derives workers from the PostgreSQL connection budget: 2 connections select one process, 4 select two workers, and 8 select four workers. These are coupled native configurations; database capacity is a disclosed treatment, not a constant. Metadata admission also differs between ordinary and supervised processes. Report total wall time, aggregate blocks/second, per-chain progress, RPC items/retries and process resource use. A fixed account throughput cap can limit gains despite more CPU parallelism.

Worker groups share a failure boundary: one failed worker stops its siblings. The supervisor also holds realtime progression until all chains finish backfill. This experiment keeps bounded recovery and eRPC provider protection; it does not promise unlimited throughput or independent restarts.

Storage milestone validation: all nine ordered repository checks passed, including all four application images. The native 429/late-fork atomicity test passed in 68.9 seconds. The expanded PostgreSQL restart/rollback test passed in 3.8 seconds. Astra reviewed correctness; Ponytail's simplification removed the redundant per-instance Etherscan limiter. These are correctness measurements, not indexing-speed results.

The initial worker-profile scout reused the old Robinhood benchmark's eight-second capacity adapter. Its indexer completed, but adapter exhaustion invalidated the result. Native protocol v2 removes that compatibility adapter: both the performance parent and native variants already own production retries. No timing from the failed adapter-backed scout is accepted or compared to direct-path runs. HyperSync, the 50-credit cap and observation cadence remain unchanged. Proxy capacity/outcome counters and per-process HTTP status counts record throttling without provider text or URLs.

## Metadata allocation milestone

The initial one-slot-per-worker policy left the fifth permitted metadata slot unused. The revised policy gives the unique Ethereum worker two starts/second and every other worker one. Envio 3.14.1 assigns each chain once and starts at most four workers, so the total is at most five starts/second per metadata service. Unknown worker metadata retains one slot. This is an explicit preference for mainnet bootstrap, not a general workload allocator.

The IPC regression first rejected the old one-slot allocation, then passed at the 499/500 ms boundary. An added fractional-clock/early-wakeup case caught premature admission; the implementation now rounds waits upward and rechecks the monotonic deadline after every wakeup. All three metadata regressions and the full nine-step validation passed. The earlier cold scouts remain evidence for the original allocation; a new replay measures this revision separately.

## Private-proxy timeout milestone

The client previously inherited viem 2.57.7's 10-second HTTP deadline, including response-body reading. The private proxy permits 20 seconds per upstream attempt and 45 seconds for network recovery. The client now explicitly permits 50 seconds so it does not cancel the proxy before that configured recovery window finishes. Six client attempts, ten active requests and 256 queued requests per process, batching and the default 50-credit proxy budget remain unchanged.

A real local HTTP fixture flushes headers and completes its body after eleven seconds. Before the change it observed two requests; afterward it observes one. This is 50% fewer HTTP attempts in that deliberately slow-response fixture, not a whole-indexer speed claim. A separate stalled-body fixture accelerates only the configured 50-second timer and verifies six attempts, identifiable sanitized exhaustion and recovery on a subsequent healthy request. Existing RPC queue, revert and reader-boundary checks also passed.

One exhausted call can now take roughly five minutes plus backoff and queue waiting. The attempt count and queue size are bounded; total queue waiting time is not. The mismatch is a confirmed mechanism for avoidable cancellation, but it does not identify the cause of the observed replay failures.

## Measured results

The accepted comparison is **50 versus 100 eRPC unit credits on the same revised four-worker source**, not this branch versus its parent. The [compact machine-readable report](performance/indexer-native-capacity-comparison.json) records source/image identities, raw-artifact hashes, rejected experiments and equality checks. Detailed diagnostics remain under the existing ignored `benchmarks/` directory.

Six cold local trials ran in 50/100/100/50/50/100 order at commit `967bce4`, with real HyperSync and private RPC services. Each replay indexed the same 80,004 blocks across Ethereum, Arbitrum, Base and Optimism. Every trial used new indexer and eRPC databases, four native workers plus one supervisor, eight PostgreSQL connections and unchanged 10,000/100 observation intervals. The actual provider account allowance was not changed or measured.

| Metric, median of three trials | 50 credits/second | 100 credits/second |
| --- | ---: | ---: |
| Committed elapsed seconds | 104.925 | 84.634 |
| Committed blocks/second | 762.5 | 945.3 |
| Proxy RPC items | 5,712 | 5,557 |
| Upstream RPC items, including housekeeping | 3,759 | 3,731 |
| Total process CPU seconds | 24.14 | 17.68 |
| Sum of process peak RSS, MiB | 1,121.2 | 1,040.0 |
| Sourcify HTTP requests | 191 | 191 |

The 100-credit treatment delivered **24.0% higher throughput and 19.3% less elapsed time**. All six runs completed. All 20 entity tables had identical exact digests, including cache contents and verification provenance; no policy-function ordering exception was needed. All four chains reached their endpoints with equal Envio progress/event counters. There were 151 verified-deployment rows. No upstream `rate_limited` or `cancelled` outcome was recorded in these six trials. This does not establish the private account's limit or guarantee availability during sustained overload. RPC-item differences are not a provider-billing measurement.

The original worker scouts, before timeout alignment and with one metadata slot per worker, were:

| Configuration | Seconds | Blocks/second |
| --- | ---: | ---: |
| Performance parent `ac5eab8`, one shared-storage process | 126.989 | 630.0 |
| Native storage, one processing group | 140.277 | 570.3 |
| Native storage, two workers | 178.521 | 448.1 |
| Native storage, four workers | 147.936 | 540.8 |

Giving Ethereum the spare metadata slot produced two four-worker scouts at 106.319 and 103.514 seconds, still with the old client deadline. Their successful final data matched the parent. However, the subsequent matched parent confirmation stopped with `RpcTransientFailure`, as did one earlier 100-credit parent trial. The parent also failed at 50 credits, so those failures cannot be attributed to the higher cap alone. They remain recorded, not silently discarded. **No confirmed parent-branch speedup percentage is claimed.** Earlier scouts do not validate the final timeout revision.

The successful shared-process parent scout used about 304 MiB of peak RSS, versus about 1,065 MiB summed across the original four-worker configuration, including its supervisor. Native worker groups therefore have a material memory/startup cost. PostgreSQL connections and metadata allocation also change with worker treatment. These local windows do not establish performance under Railway's one-CPU/two-GB limit, full-history indexing, warm persisted state or live deployment.

## Validation and remaining decisions

The final code passed the ordered nine-step validation, including all four required application image builds. The real patched-eRPC/PostgreSQL integration passed in 79 seconds with database-reset checks explicitly disabled. It verified nine revert/privacy cases through viem and the production dependency reader, HTTP/JSON-RPC 429 recovery, six-attempt exhaustion, primary-to-secondary failover, terminal reverts, cache restart persistence and the aggregate mixed-method/chain budget. Trivy passed the indexer image, RPC cache image and Dockerfile checks at the repository's medium/high/critical thresholds, using existing ignore policy.

Astra advised each implementation stage; Ponytail checked simplification. Completed source reviews left no actionable findings. The later HTTP timeout fix and its tests have a separate completed review. All commits are unsigned local milestones. The original performance and Robinhood branch refs, live settings, existing databases and PRs were not changed.

The repository default eRPC budget is now 100, following the accepted capacity experiment above. Existing explicit operator overrides remain effective; no live variables or deployments were changed. The standardized benchmark retains its fixed 50-credit control unless the separate capacity profile is selected. Adaptive eRPC tuning remains disabled. Its pinned per-upstream tuners do not coordinate modifications to a shared account budget; the default one-minute/five-percent adjustment is not a substitute for a validated account-wide controller. Alchemy throughput is finite and account-wide; more keys within one account do not add capacity. See [eRPC rate limits](https://docs.erpc.cloud/config/rate-limiters) and [Alchemy throughput](https://www.alchemy.com/docs/reference/throughput).

The requested additional 50–100% improvement over the optimized baseline is not demonstrated. A promising next experiment is precomputing verified getter-discovery results for the known inventory, using the existing metadata generator, including code-hash-bound conclusive negative results. The measured cold replay still made 191 Sourcify requests (190 HTTP 200 responses and one 404). Removing safe, repeated discovery from cold startup should be measured before assuming another RPC provider will solve that bottleneck. Unknown/new contracts must retain automatic runtime discovery.

Long-outage recovery is a separate remaining decision. Failed effect invocations can be retried, but handler entity writes immediately modify native in-memory tables; `withCanonicalObservation` validates headers and does not provide a handler savepoint. A simple catch/sleep/rerun wrapper is unsafe. The smallest recovery experiment is restarting a failed native process group after cooldown against the same durable database, then proving equality with an uninterrupted run. Repository Railway configuration currently permits one restart; this experiment did not change it. An independent archive-provider fallback with its own account budget is another reliability option. Neither follow-up has been implemented or deployed here.
