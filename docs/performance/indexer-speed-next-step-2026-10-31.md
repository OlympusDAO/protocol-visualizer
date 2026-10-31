# Proposed next experiment: bounded contract-subject scheduling

Status: awaiting user approval. No scheduling implementation is included.

The approved cache stages reduced proxy requests by 75.1% and improved one matched cold replay by 20.7%. Subsequent 35/second runs reached 346.5–354.4 blocks/second; the direct 40/second run reached 354.0. The cold target remains 430.2–573.7 blocks/second. Source and RPC latency vary, so these separate trials do not establish a precise incremental gain from either effect setting.

The next candidate is serial scheduling in `completeRelationshipBlock`. Database loads are not the measured bottleneck. Its field loop awaits each getter before starting the next field, while the transport already supports bounded concurrency and HTTP batching. Adding another cache or raising eRPC's cap would not address that ordering.

## Smallest proposed change

After the existing canonical preflight, group fields by normalized contract address. Preserve every field in each group's input order, including duplicates and token-scoped registry getters. Run at most two groups concurrently. Keep the existing per-field replay checks, reads and writes together; do not introduce a separate preparation representation, configuration variable or general scheduling library.

Any exception or canonical failure stops new group and field starts. Drain both active processors with `Promise.allSettled` before propagating failure. Write this function's completion observation only after both processors succeed. Preserve the outer canonical phase and native atomic commit boundary.

Astra inspected the production callbacks and found the subject boundary defensible: ownership presentation and pending/current updates stay on the same subject; Kernel keys include subject/getter; shared verified target facts use equivalent creation-block provenance. This is specific to these callbacks, not a concurrency guarantee for arbitrary getter functions. Ponytail favors this local fixed-size change over another cache or a generic preparation/application framework.

## Required proof before keeping it

- Show real overlap for two subjects, a third subject waiting and a maximum of two active groups.
- Preserve same-subject order with mixed-case aliases, duplicate getters, owner/pendingOwner and governor/newGovernor; compare complete entity maps with serial results.
- Keep all token-administrator getters of a registry together and preserve their distinct token rows.
- On exceptions and replay canonical failures, prove the handler waits for in-flight reads, starts no new work and writes no completion observation.
- Preserve event replay's zero-getter path and shared-target creation provenance.
- Rerun native SQL rollback/restart, late canonical failure and retry-exhaustion checks, then the nine ordered validation steps.
- Compare against the retained finite configuration with identical normal-size batches, range, checkpoint interval, fresh databases and upstream cap. Confirm a promising result with three sequential paired runs and a state-change holdout.

At 144.302 seconds, the 35/second trial needs another 28.087 seconds saved to meet the 116.215-second target. Two groups may overlap serial waits; they do not inherently reduce cold RPC counts or guarantee that gain. Reject the change if it mostly adds capacity rejections or changes results.

HyperSync, 10,000-block observations, the eight-active/256-waiter transport guard, retry settings and aggregate 50-credit eRPC budget remain unchanged. No per-chain indexing workers, Multicall, dependencies, live variables, deployment or database reset are proposed.
