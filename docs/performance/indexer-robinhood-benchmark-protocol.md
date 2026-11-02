# Robinhood-base replay acceptance protocol

This profile compares `9eb4755be2904f6751a72890ecce134c4c701fef` with the retained runtime at `4198a0a2118fb8cf674c90d37f11bfcc2339c07e`. The existing strict v1 comparison remains unchanged. Native scouts are diagnostic only: the base left 79 relationship reads unavailable, so their timing cannot establish an equal-work gain.

## Measurement

Use three cold trials per revision, alternating A/B, B/A, A/B. Keep Node, pnpm, lockfile, driver, provider profile, image IDs, Ethereum range 26,240,000–26,290,000, native batch size and checkpoint frequency equal. Preserve each revision's application source and event subscriptions.

The queued v2 fixture forwards the original HTTP batch and retries only its explicitly capacity-rejected members. It retains eRPC's aggregate 50-credit cap, bounds active envelopes, waiters and outstanding logical requests, and fails on exhaustion. Queue/retry time is inside the timed interval. This is a shared recovery fixture, not a production deployment or a change to the base application's retry policy. Child CPU measurements exclude the host relay.

Measure process launch to durable end-block completion; require readiness, normal exit and complete cleanup. Keep every failed/scout attempt separate. Compare median times, and calculate throughput gain as `100 * (baseline median time / candidate median time - 1)` only after acceptance passes.

## Equal work and useful results

- Keep exact native config hashes. The only permitted config difference is the added `OwnershipTransferStarted` subscription, and only after independent canonical logs prove it contributes no work in this range.
- Query the union of configured addresses/topics. Compare exact ordered log identities against both native workloads. This bounded profile rejects effective dynamic registrations rather than assume their address closure is complete; registry events for other tokens remain in the manifest but do not register pools. Check equal processed-item counts and unchanged block-handler schedules separately.
- Require repeatable complete state within each revision. No transport/capacity-induced unavailable result is allowed. The two source-proven private pending-owner getters form the only getterless allowlist.
- Compare every shared business value, identity, relationship, status, scope, function context, transition, indexed frontier and history. Normalize only the already-declared policy-function ordering.
- Preserve complete raw state privately. Explicitly audit each changed proof field; unknown changes fail. Do not blanket-strip verification, seed, coverage or provenance.

## Proof obligations

Run an independent fresh historical getter oracle using the base production readers, bypassing indexer effects and entity caches. Check every readable relationship at the final canonical block, complete Kernel dependency sets, and every differing recorded getter observation. Validate target-code annotations against actual bytecode.

For immutable-derived provenance, require the compiler/source/runtime deployment descriptor, allowed exact getter, empty-parent/creation runtime proof, canonical anchors and matching creation/final values. For Kernel reuse, require the reviewed runtime, current epoch, canonical original verification, complete dependency set and absence of intervening actions. For ownership replay, require an actual canonical seed read, exact implementation profile, complete subscriptions and replayed canonical events. Reused facts must retain their actual verification blocks.

Reviewed precomputed immutable descriptors are fingerprinted inputs; other descriptors are reconstructed from the verification service. Fresh runtime, lifetime and value checks apply in both cases. The two private-getter exceptions additionally require matching verified runtime/source, private pending-owner state with no public getter/fallback, and an actual EVM revert; transport unavailability cannot satisfy the exception. A nominee observed in a transfer request is checked against that canonical event without pretending a public getter exists.

The only seed-row identity change admitted is a same-address/getter/value seed moving from the replay start to its proven immutable deployment boundary. Validate both boundaries; retain all other seed/history differences as failures. Additional target-code evidence and reviewed ownership coverage text are admitted only with their corresponding oracle/profile proof.

The percentage describes equal verified business state under this fixed recovery profile; physical proof records intentionally differ. It is not a strict v1 byte-for-byte result, a live nine-chain guarantee, an existing-database migration test or an Alchemy billing claim. Record independent-oracle and provenance-audit results with the final artifacts before preparing the PR text.
