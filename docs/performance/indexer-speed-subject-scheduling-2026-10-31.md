# Bounded relationship-subject scheduling

This implements the approved [next experiment](indexer-speed-next-step-2026-10-31.md). The direct comparison starts from 6a9f9ac, which already contains deployment entities, canonical phases and finite 35/second getter/raw-call gates. The retained 50–100% cold-replay target is 430.2–573.7 blocks/second against the recorded 286.8 reference.

## Implementation and safety boundary

`completeRelationshipBlock` groups eligible fields by normalized contract address after its whole-inventory canonical preflight. Two local processors claim groups from a native Map iterator. Each subject keeps every field in its original order, including duplicate getters, mixed-case aliases and registry tokens. The existing field loop and replay checks remain in place.

A canonical failure or exception stops new group and field starts. Both processors settle before the handler propagates failure, and this function writes its completion observation only after success. Already-started fields may finish staged writes during draining; the enclosing canonical phase and native batch boundary prevent failed observations from committing. This is not an additional Envio indexing worker, per-chain process, queue or configuration option.

Astra identified an inherited nested drain gap: a Kernel pointer effect could reject a `Promise.all` while sibling deployment verification continued toward an entity write. The public getter regression reproduced early settlement with the deployment branch held open. That pair now uses `Promise.allSettled` and propagates rejection after both branches settle. The regression verifies a real production-path deployment write occurs before the reader returns, while the transient error still propagates and no Kernel fact is seeded.

## Regression and review evidence

Three of five scheduling checks failed on the serial implementation, then passed with overlap and draining. The other two characterize semantic ordering and event-replay avoidance. The focused suite also proves equivalent creation facts from independent readers of one cold deployment.

| Check | Evidence |
| --- | --- |
| Overlap and bound | Two held subjects start, a third waits, peak active count is two, completion waits for all |
| Ordering | Mixed-case aliases, duplicate getters, owner/pendingOwner, governor/newGovernor and two registry tokens match sequential subject results |
| Failure | Exceptions and replay canonical failures drain an active sibling, start no further field/group and write no completion observation |
| Event replay | Eligible ownership replay stays getter-free while another subject reads |
| Shared target facts | Independent native-effect contexts write equivalent creation hash, code hash and original verification provenance |
| Nested verifier failure | Public getter retains ownership of a held deployment branch and propagates the identifiable transient error afterward |

Astra's stage review and follow-up found no remaining actionable defect after the nested drain fix. Ponytail and five simplification lenses replaced a copied group array/index with the native iterator and preserved the original start-block predicate, including NaN exclusion. The existing TypeScript library does not declare `Map.groupBy`, so ordinary Map construction avoids changing compiler settings or dependencies.

Strict indexer typechecking and all nine ordered validation steps passed: 133 ordinary indexer tests and one explicit opt-in SQL skip. The actual native PostgreSQL rollback/restart fixture passed separately in 1.67 seconds. The actual patched eRPC/PostgreSQL integration also passed, including dependency-reader capacity recovery and the aggregate mixed-method/mixed-chain budget; reset checks were explicitly skipped. The dedicated seven-lens code review completed with no findings (`20261031-213318-dac150eb`); performance acceptance remains separate.

## Measurement status

No whole-indexer gain is claimed from the overlap fixture. The immutable-commit, normal-batch paired HyperSync replay used the same 50,001 Ethereum blocks and fresh disposable SQL/proxy-cache databases. Checkpoint interval, source, eRPC 50-credit cap, client bounds and retry policy remain unchanged.

| Normal-batch direct comparison | Serial 6a9f9ac | Two subjects 1ddb54a |
| --- | ---: | ---: |
| Committed range time | 155.096 s | 127.718 s |
| Blocks/second | 322.4 | 391.5 |
| Proxy RPC items | 6,023 | 6,165 |
| Upstream requests including probes | 4,360 | 4,299 |
| Recovered budget rejections including probes | 37 | 238 |

Both runs committed 523 events, reached ready state and exited normally. All 20 entity types match exactly, including facts and complete relationship provenance; the same two observations remain unavailable. The pair has 21.4% higher throughput, but source fetches summed 64.594 seconds on the baseline and 6.433 seconds on the candidate. These overlapping timings are not additive wall-time slices, and the paired gain alone is not conclusive. The candidate's absolute rate is 36.5% above the recorded 286.8 reference, still below the 430.2 target. [Measurements](indexer-speed-subject35-2026-10-31.json).

The pre-completion scrape reports 37.88 seconds of getter-window waits. Astra advised retesting the previously approved finite 40/second variant under the new demand pattern. This changes only the getter/raw-call constants. Require a repeatable gain of at least 3%, exact entity parity, readiness and normal exit; report the 116.215-second target separately. Stop on exhaustion, queue overflow, incomplete progress or state divergence. Retain 35 if increased rejection traffic has no repeatable benefit. No additional cache, queue, indexing worker or provider budget is introduced.

The two-line 40/second variant passed all nine ordered validation steps with the same 133 ordinary tests and explicit SQL skip. Astra reviewed the retest decision in a fresh high-effort context; Ponytail retained the constant edits without adding settings or tests that duplicate them. Its speed and capacity behavior are still experimental until the matched replay completes.
