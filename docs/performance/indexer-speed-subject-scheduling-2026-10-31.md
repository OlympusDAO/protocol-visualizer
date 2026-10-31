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

Strict indexer typechecking and all nine ordered validation steps passed: 133 ordinary indexer tests and one explicit opt-in SQL skip. The actual native PostgreSQL rollback/restart fixture passed separately in 1.67 seconds. The actual patched eRPC/PostgreSQL integration also passed, including dependency-reader capacity recovery and the aggregate mixed-method/mixed-chain budget; reset checks were explicitly skipped. The dedicated code review is in progress before final acceptance.

## Measurement status

No whole-indexer gain is claimed from the overlap fixture. The next step is an immutable-commit, normal-batch paired HyperSync replay over the same 50,001 Ethereum blocks, with fresh disposable SQL and proxy-cache databases. Checkpoint interval, source, eRPC 50-credit cap, client bounds and retry policy remain unchanged. A promising result requires confirmation and full entity/provenance comparison.
