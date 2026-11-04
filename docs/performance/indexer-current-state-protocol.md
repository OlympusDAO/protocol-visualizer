# Robinhood-base current-state benchmark protocol

Compare `feat/robinhood-chain` commit `9eb4755be2904f6751a72890ecce134c4c701fef`
against the committed current branch. Recent performance commits are diagnostic
controls, not the baseline for the PR speedup.

The primary workload is Ethereum 26,240,000–26,290,000 inclusive. Use three cold
trials per revision in A/B, B/A, A/B order after a baseline-only qualification.
The optional four-chain holdout uses the existing fixed native-worker ranges,
one process and two PostgreSQL connections. Both revisions use identical pinned
runtimes, dependencies, immutable proxy/database images and a finite aggregate
100-credit proxy budget. HyperSync remains the event source.

The base can swallow capacity errors and advance without complete reads. Apply
the existing bounded queued-recovery fixture to **both** revisions. It forwards
original HTTP batches and retries only explicit capacity rejections, without
changing getter arguments, values or entity writes. Queue time counts toward
elapsed time. The candidate also retains its production client bounds. This is
a matched recovery profile, not a claim that the original unmodified base always
recovers gracefully. The proxy cap does not increase Alchemy's account allowance.

The branch deliberately removes historical getter observations and five archive
tables. Compare the base's 17 entity types with the candidate's 12 current types.
Do not describe these runs as equal historical work or weaken older protocols.
Record actual source/config/transport/metadata hashes. The common workload records
the baseline configuration hash; each source retains its own actual configuration
hash. Added subscriptions or dynamic registrations must produce the same canonical
event manifest and native event counts, or the comparison fails.

Require exact repeatability within each revision and complete durable endpoint
progress. After timing, run baseline production readers directly against the
private proxy, bypassing indexer effects and entity facts. Derive expected getter,
module, task, enablement, bridge and role coverage from configuration, prepared
metadata and canonical events. Check every expected row, every readable current
value, complete module-dependent sets, bridge selector coverage and target code.
Share canonical header/code witnesses only inside this audited phase; recheck all
used headers fresh before accepting it. Bind receipts to raw state, source refs,
loader/runtime hashes and the audit implementation.

Allow only these documented differences:

- Observation seeds can move to the endpoint or become absent when only events
  establish that field. Check retained boundaries canonically and replay actual
  recorded seed values through fresh readers. Event `lastChange` stays exact.
- Successful candidate verification must name the canonical endpoint and agree
  with fresh reads. Permit only known verification fields and reviewed ownership
  policy additions/updated verification blocks. Unknown nested proof fields fail.
- Getter-only provenance can move to the actual endpoint observation when neither
  revision claims an event change. Preserve current values, identity and status.
- The new full-verification version is exactly 1. Additional ownership coverage
  and target-code annotations need matching runtime/oracle evidence.
- A first ownership transition may lose a prior getter-derived `previousValue`.
  Admit only an address becoming unknown, with no earlier transition and a
  matching canonical transfer event's `from` value. No extra object fields pass.
- Chainlink `newOwner` is event knowledge, not a public getter observation. The
  explicit exception requires a subscribed Chainlink identity, an actual EVM
  revert and a canonical transfer/request establishing the displayed nominee.
  Without such an event, only an unknown null value is accepted. It remains
  unavailable in verification; no claim of reading private state is made.

Seeded policies with unknown installation history remain unknown; do not turn
their seed `isEnabled: false` into an assertion about actual activation. Check
Kernel activation where history establishes it and compare unknown records exactly.

All other shared business fields, rows, roles, memberships, events, scopes,
function contexts and meaningful array order must match. Only the previously
specified policy-function ordering normalization remains. Missing rows, transport
failures, stale receipts or unexplained differences withhold the percentage.

The primary acceptance gate is at least 10% higher median committed throughput,
with every candidate trial faster than every baseline trial. The holdout may not
regress more than 5%. Report actual gains separately from the user's larger
50–100% target. Keep failed trials; never replace them silently. Audit RPC occurs
after timing and is excluded from measured request counts. These bounded local
replays do not establish live nine-chain speed, full-history speed or billing.

Run the command documented in the repository benchmark skill. Keep full states,
audits and trial results in ignored local diagnostics. Commit only the compact
comparison report, with raw-file hashes, under `docs/performance/`.
