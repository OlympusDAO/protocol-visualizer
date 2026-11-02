# Standard indexing benchmark comparison

The retained configuration reaches **404.7 committed blocks/second**: ten active proxy requests, 256 waiters, 35/second getter/raw-call effect gates, two ordered contract subjects, and the unchanged aggregate 50-credit eRPC cap. HyperSync, 10,000-block checkpoints and the native batch size of 5,000 are unchanged.

The standard command ran three fresh cold Ethereum replays per source over blocks 26,240,000–26,290,000. Baseline `f193d3c` is the recorded already-optimized performance reference, not the full branch's original `feat/robinhood-chain` base. Candidate `5076eec` has the same runtime-input fingerprint as the retained branch after the rejected experiment was reverted. Images, runtime, driver, provider profile and event workload match.

| Median metric, three runs each | Optimized baseline f193d3c | Retained candidate 5076eec |
| --- | ---: | ---: |
| Committed elapsed time | 188.864 s | 123.540 s |
| Committed blocks/second | 264.7 | 404.7 |
| Indexer-to-proxy RPC items | 24,337 | 6,169 |
| Proxy header requests | 20,389 | 1,886 |
| Upstream requests, including probes | 4,119 | 4,328 |
| Process CPU time | 36.596 s | 16.584 s |
| Recovered local capacity rejections | 15 | 205 |
| Events processed, every run | 523 | 523 |

Observed throughput increased **52.9%**, committed time fell **34.6%**, proxy traffic fell **74.7%**, header traffic fell **90.7%**, and median application CPU time fell **54.7%**. Shared entity values and verification provenance pass the standard comparison; the candidate additionally stores 97 `VerifiedDeployment` rows. Both variants reached readiness and exited normally in every run. Existing cache facts also pass the strict shared-state comparison. No normalized ordering difference was reported between the representative runs.

There are zero shared value/provenance differences across the 19 common entity types. Exact raw-call reuse retains chain, full request parameters and canonical block-hash identity. Deployment reuse requires source/runtime binding, creation proofs and deployment boundaries; Kernel facts require the proven implementation and unchanged event epoch. Observation-local header reuse ends with fresh canonical checks before acceptance, and reused values retain their actual verification block. Unknown or invalid proofs fall back to reads. Regression and native rollback/restart fixtures exercise failure boundaries; equivalent replay output establishes this workload's behavior, not universal cache correctness.

These figures describe a controlled local replay with real HyperSync events and configured providers, not a live deployment. The baseline durations varied substantially: 309.805, 180.748 and 188.864 seconds; candidate durations were 122.503, 124.853 and 123.540. Source fetches summed 26.834, 2.889 and 6.541 seconds versus 4.127, 5.670 and 5.866; those overlapping totals are not additive wall-time components. The small sample and uncontrolled service/network variation limit causal attribution and extrapolation.

The fixed historical reference was 286.8 blocks/second. The retained result is **41.1%** higher than that reference and remains below its **430.2** lower target. The fresh paired +52.9% result does not erase that unmet absolute target or establish a 50% gain against the earlier measurement window.

Upstream requests increased **5.1%**, rather than falling: cold source/deployment safety proofs add reads. Upstream `eth_call` remains 3,097 per run. Most eliminated header requests previously hit eRPC's cache. The result demonstrates less indexer/proxy work and faster indexing, not provider billing savings or account-wide Alchemy compute-unit headroom. No upstream capacity/transport failure outcome was recorded, and all recovered local budget rejections completed without changing observations.

The direct eight-to-ten permit comparison improved median throughput **6.9%**, from 378.5 to 404.7 blocks/second. All ten-permit runs finished faster than all eight-permit runs. Raising the effect gates to 40 failed its predeclared scout threshold: 385.8 blocks/second with 269 recovered budget rejections, so 35 was restored. [Decision and validation](indexer-active-permits-2026-11-01.md).

Artifacts: [standard candidate](indexer-benchmark.json), [optimized baseline](indexer-benchmark-baseline.json), [eight permits](indexer-benchmark-eight.json), [ten/35](indexer-benchmark-ten35.json), and [rejected ten/40 scout](indexer-benchmark-ten40-scout.json). The [repository skill](../../skills/protocol-visualizer-benchmark/SKILL.md) defines when to run and how to include comparisons in an authorized branch PR. This report is local evidence; no PR was updated. A future PR must identify its actual base and distinguish this experiment baseline from a full-branch comparison.

```sh
pnpm benchmark:indexer --compare docs/performance/indexer-benchmark-baseline.json
pnpm benchmark:indexer:compare BASE_REF
```

The [next investigation proposal](indexer-speed-next-investigation-2026-11-01.md) is separate from these implemented milestones. No additional speed gain is assumed.

The retained runtime passed all nine ordered validation steps, with 133 ordinary indexer checks and twelve benchmark checks. The actual native SQL rollback/restart and patched eRPC/PostgreSQL integrations passed separately. A final scan of the rebuilt indexer image reports 24 MEDIUM OS advisories, no HIGH/CRITICAL and no secrets. The newer vulnerability database adds unfixed `CVE-2026-84243` for existing `libc6` 2.41-12+deb13u4; installed packages are unchanged from the earlier 23-finding scan. The MEDIUM threshold still fails. eRPC has no unsuppressed findings under the unchanged policy, and no ignore entry was added. Native rollback is tested directly; a real HyperSync reorg dispatch remains outside this validation.

The optional `--install-deps` path also completed an actual isolated frozen network install and a one-block replay with durable progress, readiness, normal exit and cleanup. That functional smoke uses a separate range and artifact; its duration is not part of the performance comparison. The source lockfile stayed unchanged and the installed snapshot matched it.

For the full branch PR, use the [fresh comparison against actual Robinhood base 9eb4755](indexer-benchmark-robinhood-comparison.md). Its separately versioned queued-recovery profile measures +142.7% median throughput with equal verified business state and explicitly audited proof differences. The historical +52.9% experiment above remains a different comparison and is not the PR-base gain.
