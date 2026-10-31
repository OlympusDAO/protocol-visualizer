# Proposal: increase indexing throughput by 50–100%

Status: analysis complete; proposed optimizations await user approval. Production code is unchanged at f193d3c. This proposal concerns the current optimized branch, not the original baseline.

Solmate Owned is already supported. Reviewed runtime/source bindings enable event reuse for Ethereum CoolerV2Migrator and CCIPCrossChainBridge. OZ Ownable v4/v5 and Ownable2Step profiles are also implemented; future deployments need their own reviewed bindings.

## Measurable target

Keep HyperSync, 10,000-block checkpoints, existing observation coverage and correct historical results. Measure committed progress, not buffered blocks.

| Primary Ethereum replay | Current recorded baseline | +50% throughput | +100% throughput |
| --- | ---: | ---: | ---: |
| Blocks | 50,001 | 50,001 | 50,001 |
| Blocks/second | 286.8 | 430.2 | 573.7 |
| Wall time | 174.323 s | at most 116.215 s | at most 87.162 s |

A 50% throughput gain requires 33.3% less time; doubling throughput requires 50% less time. The target is for this fixed replay. A nine-chain aggregate throughput claim requires a separate multichain comparison.

## New locating measurement

One additional unmodified replay used fresh disposable databases, real HyperSync events and configured upstream providers. Passive instrumentation measured fetch envelopes and process CPU. Envio and eRPC metrics supplied scheduler and service timings. No proposed optimization was tested.

- Completion: 173.817 seconds, 287.7 committed blocks/second, 523 events and 579 relationships.
- The complete relationship-row digest, including verification provenance, exactly matches the previous candidate replay.
- HyperSync log fetching took 0.265 seconds; the source buffered the bounded range early. Fetching more events faster is not the leading opportunity in this case.
- An interim Envio scrape recorded 61.846 seconds of getter-effect window waits, 14.246 seconds for canonical-code effects, 6.379 seconds for raw-call effects and 1.027 seconds for bytecode effects.
- The same scrape recorded 2,640 completed getter effects. Several effect types each impose a separate 25-calls/second limit.
- There were 20,389 header requests; 20,358 hit eRPC's cache. Header cache lookup service time summed to 25.609 seconds, before considering client formatting and repeated payload handling.
- HTTP batching is already effective: 24,338 logical RPC items used 10,160 HTTP envelopes, averaging 2.40 items per envelope. More than half the items were in six-item batches. Envio already overlaps checkpoint preload work.
- The Node process used 27.697 CPU seconds over 172.574 seconds of measured process lifetime. A CPU-only rewrite is not the first candidate.
- Source discovery made 91 successful requests with 2.768 seconds of summed fetch time in this run. Source-service outages remain a separate latency risk.

These counters are not additive slices of wall time. Effects nest, work overlaps, and queue counters measure scheduler windows. The Envio scrape is interim: the CLI exited before the final scrape, so its counts are lower bounds. Fetch timing stops at response headers. Low HTTP-envelope concurrency does not imply low logical RPC concurrency when batches contain several calls.

Raw evidence and capacity calculations: [analysis artifact](indexer-speed-analysis-2026-10-31.json). The passive replay confirms the baseline; it does not demonstrate an optimization gain.

## Stage 1: coordinate the existing finite effect limits

This is the first implementation experiment I recommend approving. Getter, raw-call and code-verification effects currently throttle different units independently. Work saved inside a getter still waits for the outer getter's next window. This explains why fewer RPC reads can leave indexing speed flat.

Test coordinated finite limits of 35 and then 40 calls/second for the demonstrated bottleneck effects. Keep the eight-active/256-waiter RPC guard, bounded viem recovery and the shared 50-credit eRPC admission budget. Keep source-service and Etherscan limits independent. Do not disable every effect limit or raise the provider cap.

The 2,640 observed getter operations imply approximately 105.6 seconds of capacity at 25/second, 75.4 seconds at 35/second and 66.0 seconds at 40/second. Those are scheduling-capacity calculations, not predicted replay durations. They identify roughly 30–40 seconds of potential scheduling improvement. Raising only one layer may move the queue into another layer, so measure all three.

This stage is the simplest way to test the primary bottleneck. It is likely insufficient alone for doubling throughput. Add bounded prefetch of independent reads only if the new profile shows underfilled work after retuning; existing preload/batching means a new queue is not justified merely by seeing a sequential loop. Preserve the order of entity updates and event handling.

## Stage 2: share canonical verification within bounded observation phases

The second experiment should reduce repeated fresh checks of the same current and historical headers. Most of the 20,389 header requests return already cached data, yet still incur database lookups, HTTP work, JSON decoding and block formatting.

Prepare a bounded set of hash-pinned reads, validate each unique anchor at the opening and final acceptance boundaries, and apply entity changes only after the final checks pass. Creation anchors, reused getter anchors and current target-code observations must all remain covered. A changed anchor rejects the whole prepared observation. Do not cache numeric-height headers across phases or treat a stale persisted effect as fresh canonical evidence.

This is a correctness-sensitive structural change. The goal is substantially fewer repeated header requests, while preserving the protection added by the recent fork fixes. It needs real-runtime reorg, rollback, restart and failure tests before keeping it.

Stages 1 and 2 together are the best-supported route toward a 50% gain. A 100% gain remains a stretch target. Their savings overlap and must not be added as a forecast. Success must come from paired replay measurements.

## Options to defer

| Option | Why it may help | Why it is not first |
| --- | --- | --- |
| Selective Multicall3 | Combine several eligible contract reads into one eth_call; lower request demand could make 2× more sustainable | Changes caller semantics; requires proven caller-independent getters, exact historical block pins, deployment availability and correct per-item revert handling |
| Per-chain workers | Reduce cross-chain interference and use more cores during multichain indexing | All 19 entities currently use shared storage; needs a partitioning/migration and rollback plan. It does not double a single Ethereum worker, and all workers must share the same provider budget |
| More event-maintained mutable getters | Eliminate quiet-checkpoint reads where complete source/runtime event coverage is proven | Benefit depends on remaining getter distribution; broad caching by event name would be unsafe |
| Precompute source proofs during metadata preparation | Reduce cold-start variability and source-outage waits | Healthy source requests summed to only 2.8 seconds here; it does not explain the main 174-second runtime |
| Raise eRPC/provider RPS | More theoretical upstream capacity | The current replay averages only 23.6 upstream requests/second against a cap of 50. Fix scheduling and redundant work before increasing account pressure |

[Viem multicall](https://viem.sh/docs/contract/multicall) uses Multicall3 and supports per-call failures. That capability alone does not prove equivalence to our direct calls. [Envio supports up to four workers](https://github.com/enviodev/hyperindex/releases/tag/v3.13.0) when storage is per-chain; the pinned local Config implementation rejects shared entities. [Envio effect scopes](https://docs.envio.dev/docs/HyperIndex/effect-api#per-chain-effects) also affect cache identity and multiply per-chain budgets, so worker isolation requires an explicit budget plan.

## Provider headroom

The recorded replay used 4,107 upstream requests. With the same request count, a 1.5× replay would average 35.3 requests/second; a 2× replay would average 47.1. Doubling is close to the current 50-credit cap and leaves little burst headroom. Reducing requests makes the higher target more sustainable.

These are proxy-capacity calculations. [Alchemy limits account-wide compute-unit throughput](https://www.alchemy.com/docs/reference/throughput), including other applications, over a rolling window. A request-count cap is not proof of account quota compliance. No eRPC cap, provider plan, live variable or worker setting changes are proposed in stages 1–2.

## Proposed approval and acceptance boundary

Approve stages 1–2 as local implementation experiments. Test up to three initial variants: coordinated limits at 35, at 40, then the selected finite limits with grouped canonical verification. Keep a variant only after safety checks and confirmation measurements pass. Stop and report before expanding into workers, Multicall3, dependencies or a higher eRPC cap.

Confirmation should use three sequential paired runs on the fixed primary range and a separate historical range containing relevant state changes. Capture cold/warm source conditions, RPC and effect waits, retries, request counts, committed progress and semantic output digests. Keep the measurement protocol fixed; do not run builds alongside timing runs.

Require unchanged observation coverage, no lost events, no stale values, preserved verification provenance and no incomplete checkpoint advance after retry exhaustion. Include canonical races, real-runtime reorg/rollback, restart persistence and rate-limit stress. Run the repository's ordered validation before keeping implementation milestones. All commits remain local, unsigned and privacy-gated. No push, deployment, existing database reset or live variable change is authorized by this proposal.

The approval requested is to test these changes, not to assume a 50–100% improvement has already been established.
