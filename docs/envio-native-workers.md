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

## Metadata preparation milestone

The existing metadata generator now supports `--prefetch-deployments`; see the
[preparation runbook](indexer-operations.md#prepare-metadata-before-indexing).
It fetches Sourcify evidence ahead of indexing and bundles the processed results.
Conclusive discovery has a versioned chain/address/runtime-hash receipt, including
verified immutable ineligibility. Ordinary bytecode alone, unavailable sources
and incomplete compiler proof do not authorize a negative receipt. Runtime
negative reuse checks the observed code hash; positive lifetime reuse retains
its canonical creation/runtime checks and original verification provenance.

The preparation run refreshed 182 contracts, retained previous data for 91
unavailable contracts and skipped one already verified contract on configured
chains. The resulting 241 metadata entries contain 145 discovery receipts, 145
ordinary deployment descriptors and 40 immutable deployment descriptors. These
counts overlap. Existing checkpoint getter lists were retained; verified function
metadata and documentation were refreshed. Four previously missing metadata
entries were added. This is coverage evidence, not an indexing speed percentage.

Regression checks demonstrate zero metadata HTTP calls across two processor
instances for a prepared conclusive result, code/identity/version isolation,
proxy exclusion, native effect-codec storage and retry after partial or unavailable
source data. The CLI regression verifies that preparation preserves getter lists,
refreshes NatSpec and canonical signatures, retains roles, skips completed
downloads after restart and preserves the previous file after a targeted 429.
Astra caught a metadata-enrichment loss during review; the corrected implementation
retains the verified function metadata that runtime enrichment previously supplied.
The existing sibling-writer fault fixture now isolates its synthetic proof from
bundled metadata and retains both its write and drain assertions.

### Cold replay and correctness checks

The [metadata scout report](performance/indexer-metadata-prefetch-comparison.json)
records one cold replay per revision, using the same 80,004 blocks, four native
workers and 100-credit cap. Both completed and cleaned their disposable databases.
Baseline `0a32e13` took 90.629 seconds (882.8 blocks/second); prepared candidate
`4c624d2` took 65.409 seconds (1,223.1 blocks/second).

**No like-for-like speedup percentage is accepted.** The strict comparator found
three unequal tables, so repeated timing stopped. Seventeen other tables matched
exactly. All 755 relationship values, holders, outcomes and `indexedThrough` boundaries
matched. One immutable relationship used its creation verification for provenance
and seed; one Arbitrum authority relationship gained source context and target-code
evidence. Nine verified-deployment records were added; four have bundled ordinary
descriptors and five were discovered dynamically. Aggregate counters cannot explain
each dynamic discovery's success.

Fresh independent reads through a new disposable private proxy verified all nine
additional deployment records: canonical creation/requested headers, empty parent
code, matching ordinary runtime at creation and at the replay checkpoint. Both
differing relationships passed fresh getter and target-code checks. The immutable
factory getter retained its compiler/source proof and matched at creation and the
checkpoint. Canonical headers were checked again after reads. These checks support
the differing facts; they do not make the physical stored states identical.

Sourcify requests fell from 191 to 79, **58.6% fewer in this pair**. The baseline
recorded 179 HTTP 200, one 404 and eleven 429 responses; the candidate recorded
78 HTTP 200 and one 404. Preparation preceded the control, and the source service's
quota history was not controlled. Neither zero future 429s nor a causal timing gain
is established. Proxy requests were 5,447 versus 5,578; upstream requests were 3,734
versus 3,707. This is not evidence of RPC billing savings. One-time preparation
cost was outside the timer and was not measured; warm-state speed was not measured.

The corrected milestone passed all nine ordered validation steps. The rebuilt
patched-eRPC/Postgres integration passed with reset checks disabled, and both
indexer/RPC images passed the existing Trivy policies. Astra and Ponytail reviewed
the implementation and resulting metadata. No live variables, deployments, existing
databases or published branches were changed.

## Confirmed native worker comparison

The [worker confirmation report](performance/indexer-native-worker-comparison.json)
compares one native process with four native workers at the same 100-credit cap.
Both use commit `5c09aa2`, the same prepared metadata and the same four-chain
80,004-block workload. Scouts tested one, two and four processing groups; all
three had equal entity contents. The two-worker scout reached 942.3 blocks/second,
versus 892.7 for one and 1,190.0 for four. These scouts selected four for repeated
confirmation; their timings are excluded from the confirmation medians.

Six fresh cold trials ran in 1/4/4/1/1/4 order, three per configuration:

| Median metric | One process | Four workers plus supervisor |
| --- | ---: | ---: |
| Committed seconds | 84.480 | 68.000 |
| Blocks/second | 947.0 | 1,176.5 |
| Process CPU seconds | 15.14 | 20.93 |
| Sum of process peak RSS, MiB | 373.4 | 1,099.6 |
| Proxy RPC items | 5,541 | 5,609 |
| Upstream requests | 3,731 | 3,733 |
| Sourcify requests | 79 | 79 |

Four workers delivered **24.2% higher throughput and 19.5% less elapsed time**.
All 20 entity tables matched exactly across all six trials, including verification
provenance and cache contents. All four chains completed with equal event counters.
Each trial made 78 successful Sourcify requests and one 404; none recorded a
Sourcify 429. The real clients completed despite local proxy capacity rejections;
no upstream rate-limit or cancellation outcome was recorded. All disposable
resources were cleaned.

This compares complete native configurations: PostgreSQL worker-pool capacity
changes from two to eight connections, and metadata admission changes with worker
assignment. A supervisor can use an additional database connection. CPU and memory
cost increase; RSS is the sum of separate process peaks, not simultaneous memory.
The host has 12 logical CPUs. This does not establish performance under Railway's
one-CPU/two-GB limit, warm state or full history, or isolate the storage migration
against the historical shared-schema parent. Etherscan changes and downloads were
excluded from the frozen runtime and timing interval.

Deployment defaults remain unchanged. Selecting four workers requires
`ENVIO_PG_MAX_CONNECTIONS=8` and a fresh database with this branch's native storage
schema. Existing shared-schema databases were not migrated. One supervisor still
owns the workers' shared failure boundary, and all workers share the same eRPC
account budget.

## Etherscan source fallback

The earlier 91 unavailable entries were Sourcify misses, not failures across all
source services. The preparation command now checks Etherscan too when its key is
configured, with a separate [source coverage report](performance/indexer-metadata-source-coverage.json).
The controlled preparation checked all 91 misses: **82 returned ABI and source;
nine were unverified on Etherscan**. No unsupported-chain, authentication, quota
or malformed-response category occurred in this pass.

The remaining entries are the deployer/DAO-labelled address
`0x1a5309f208f161a393e8b5a253de8ab894a67188` on seven chains (Ethereum, Arbitrum,
Base, Berachain, Optimism, Sepolia and Base Sepolia), Sepolia `PriceConfig`
(`0xf6d5d06a4e8e6904e4360108749c177692f59e90`), and Robinhood `TokenAdminRegistry`
(`0x1912c3cfafe8a76a32a92861d815ac2837f237ca`). An unverified explorer response
does not establish whether code exists. Ordinary configured reads remain available.

Preparation added 27 missing ABI metadata entries, bringing the artifact to 268.
Conclusive deployment discovery remains at 145 receipts, with 145 ordinary and
40 immutable deployment descriptors. These counts overlap. Etherscan source/ABI
availability does not establish the compiler/runtime/creation proof needed to
increase those optimization counts. Existing nonempty metadata and valid proofs
are retained on fallback; no proxy or similar-match address is followed.

The ordinary Etherscan preparation path now obtains ABI and source from one
`getsourcecode` response instead of two API requests. CLI regressions verify this,
conservative proof preservation, missing-ABI enrichment, bounded quota/network
recovery and exhaustion, response-body timeout recovery, malformed responses,
credential redaction, no-key/getter-only gating, authentication batch shutdown
and terminal daily quotas. The confirmed worker and RPC-capacity comparisons
exclude these source-preparation changes; no additional indexing gain is claimed here.

The expanded ABI inventory also exposed two missing enablement subscriptions:
Arbitrum Sepolia `LZCrossChainBridge` (V2 `Transition`) and Sepolia
`ConvertibleDepositAuctioneerLimitOrders` (V1 `Enabled`/`Disabled`). Fresh Etherscan
lookups confirmed the exact event types/indexing and boolean `isEnabled` getter,
with neither proxy nor similar-match indirection. Their existing creation anchors
are retained, and the addresses now join the corresponding HyperSync subscriptions.
The existing capability/subscription consistency regression rejected the omission
and passes after this configuration fix. Neither chain is part of the four-chain
worker benchmark.

The final Etherscan/configuration commit `ca8cd2e` passed the full ordered
nine-step validation and indexer image scan. A subsequent four-worker regression
replay completed the same 80,004 blocks in 67.667 seconds (1,182.3 blocks/second),
with 79 Sourcify requests and exact equality across all 20 tables against the
worker confirmation data. Its own databases and proxy were cleaned. This single
run checks the final artifact; it does not establish an additional performance
gain. Its source fingerprint and raw-artifact hash are recorded separately in the
worker comparison report.

## 100 / 150 / 200 credit confirmation

The [capacity sweep report](performance/indexer-native-capacity-sweep.json)
compares nine cold replays at frozen commit `ed38d46`, in
100/150/200/200/100/150/150/200/100 order. Each indexed the same 80,004 blocks
with four native workers, eight PostgreSQL connections, new indexer and proxy
databases, real HyperSync and private RPC. Observation intervals stayed unchanged.
All 20 stored tables, including verification provenance, match across all nine
runs; event counts and completed chain ranges also match. Every fixture cleaned up.

| Median of three trials | 100 credits/s | 150 credits/s | 200 credits/s |
| --- | ---: | ---: | ---: |
| Committed seconds | 68.736 | 62.462 | 60.003 |
| Blocks/second | 1,163.9 | 1,280.8 | 1,333.3 |
| Throughput gain against 100 | — | 10.04% | 14.55% |
| Proxy RPC items | 5,644 | 5,583 | 5,541 |
| Upstream RPC items, including housekeeping | 3,731 | 3,733 | 3,731 |
| Local eRPC budget rejections | 103 | 42 | 0 |
| Total process CPU seconds | 20.87 | 19.54 | 20.13 |
| Sum of process peak RSS, MiB | 1,108.2 | 1,124.5 | 1,161.0 |

The higher budget reduced local rejection/retry pressure rather than materially
changing upstream request volume. Every run completed; upstream outcome counters
recorded successes, empty results and 44 execution reverts, with no rate-limit
outcome. Local budget rejections are not Alchemy rejections. These counters do not
establish unused account capacity or a billing reduction. Each eRPC credit counts
one RPC item; Alchemy charges method-dependent compute units across the account.

The 200-credit median is 4.10% faster than 150, but its third trial was slower
than every 150 trial. Retain the 100-credit repository default. A representative
holdout workload and shared-provider capacity checks should precede adopting a
higher operational cap. No live settings changed. These results describe a local
12-logical-CPU host, not the Railway allocation or a full historical reindex.
The frozen source excludes the subsequent label-only exclusions, Sepolia address
correction and Blockscout ABI import. Do not combine this percentage with older
worker or Robinhood comparisons as if they were one matched experiment.

The sweep profile passed 15 focused benchmark checks and all nine ordered
repository validation steps before these trials. Astra independently verified
the comparisons and stored-state equality; Ponytail reviewed the implementation
and reporting scope. Raw diagnostics remain outside tracked source; the compact
report retains their hashes, inputs and individual trial timings.

## Metadata inventory corrections

The earlier source report's nine unavailable entries have now been classified:
seven are the expected deployer/account address on separate chains and are
explicitly label-only; one was an incorrect Sepolia PriceConfig registration;
one is a Robinhood registry with a partially verified Blockscout ABI. The report
retains its historical download outcomes and records the follow-up separately.

The Sepolia PriceConfig is
[`0x68009f5e809C5A3438438312F8EEFB9F5C73d534`](https://sepolia.etherscan.io/address/0x68009f5e809C5A3438438312F8EEFB9F5C73d534).
The Olympus deployment inventory identifies it; a fresh canonical finalized RPC
read confirmed 5,391 bytes of code and its configured Sepolia Kernel. The removed
`0xf6d5…` address belongs to mainnet and was empty on Sepolia at block 12,054,378.
The correct Sepolia entry and metadata already existed; only the erroneous
duplicate registration was removed. Mainnet registration remains intact.

The Robinhood
[`TokenAdminRegistry`](https://robinhoodchain.blockscout.com/address/0x1912c3cfafe8a76a32a92861d815ac2837f237ca)
has 5,287 bytes of code and returns `TokenAdminRegistry 1.5.0` in a fresh canonical
RPC observation. Blockscout's public API succeeded in Chrome while terminal
access returned HTTP 403. Its captured ABI supplies 16 function selectors and an
ordinary `owner` getter; partial source verification supplies no lifetime proof.
The generated inventory now has 269 entries. The 145 discovery receipts, 145
ordinary deployment descriptors and 40 immutable descriptors are unchanged.
All 268 previous records remain identical.

These corrections avoid seven recurring miss checks and remove one invalid
target from broad preparation. The ABI import fills one missing record. They
have no separately accepted indexing speed percentage; the capacity sweep above
uses the earlier frozen source. No dependency versions or frontend implementation
changed. The [runbook](indexer-operations.md#prepare-metadata-before-indexing)
documents the explicit label flag and reproducible offline import.

Validation passed five focused CLI regressions and the full ordered nine-step
sequence, including all four application images. The new checks exercise forced
EOA exclusions across nine chain identities, bulk duplicate selection, preserved
display labels, the PriceConfig chain correction and offline ABI identity/error
boundaries. ABI preparation is repeatable across process restarts and preserves
existing proofs without granting new ones. Fresh address observations used the
production RPC boundary through a disposable eRPC/PostgreSQL fixture and rechecked
canonical headers after reading; its resources were cleaned up.

A final committed-source replay (`db6af44`, 100 credits, four workers) finished
in 66.612 seconds at 1,201.0 blocks/second, with 79 source requests and exact
equality across all 20 tables against the 100-credit controls. This single scout
validates the final metadata artifact; it establishes no additional speed gain.
The capacity report retains its source fingerprint and raw-artifact hash.
The rebuilt indexer passed Trivy 0.76.1's configured medium/high/critical scan,
with unfixed findings and existing repository ignores excluded. Temporary RPC
credentials and all experiment-owned containers/databases were removed.
