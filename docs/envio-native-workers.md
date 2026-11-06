# Native Envio workers

The indexer uses Envio 3.14.1's built-in supervisor and native per-chain entity
storage. It does not run independent indexers or add a custom process scheduler.
A shared-schema deployment needs an approved rebuild before using this schema;
see [indexer operations](indexer-operations.md).

## Configuration

Envio derives processing groups from its PostgreSQL connection budget:

| `ENVIO_PG_MAX_CONNECTIONS` | Processing configuration |
| --- | --- |
| 2 (default) | One process |
| 4 | Two workers plus supervisor |
| 8 | Four workers plus supervisor |

Allow additional database capacity for the supervisor and other consumers.
The default remains one process. Extra workers increase memory and startup cost;
their benefit depends on CPU allocation and the chains' workloads. The accepted
[current-state benchmark](current-state-indexing.md#robinhood-base-benchmark)
uses one process. Earlier worker experiments used historical sweeps and do not
establish a speedup for the current design.

Envio scopes entities by chain. Handlers retain chain-prefixed external IDs but
use native scoped reads and writes, including rollback. Effects retain shared
scope and include chain identity in their inputs.

## Shared capacity and failure boundaries

All workers use one eRPC instance and its finite aggregate 100-credit/s budget.
Client concurrency bounds apply per process, so more workers can increase queued
proxy traffic. Multiple replicas would need coordinated provider budgets.
Increasing a local budget does not increase Alchemy's account-wide allowance.

Metadata quotas are separate. In one process, Etherscan and Sourcify each allow
five starts/s. Native workers reserve one start/s each; the unique Ethereum
worker receives a second slot. With the pinned maximum of four workers, this is
at most five starts/s per service. Unknown worker metadata receives one slot.
This allocation depends on Envio's internal worker description and must be
rechecked on Envio upgrades or topology changes.

Workers share a failure boundary: one failed worker stops its siblings. The
supervisor holds realtime progression until all chains finish backfill. Bounded
RPC retries handle temporary capacity errors; exhaustion still stops processing.
An outer handler retry is unsafe because entity writes have no handler savepoint.

## Measuring a worker change

Compare committed sources on identical fixed four-chain ranges, fresh disposable
indexer/cache databases, the same providers and the same eRPC cap. Record the
coupled PostgreSQL and metadata-admission differences. Require canonical event
counts, current entity values and verification provenance to match.

Report committed wall time, per-chain progress, retries, CPU and memory.
The sum of separate process peak RSS is an upper bound, not simultaneous peak
memory. A local multi-core result does not establish performance on Railway's
one-CPU/two-GB allocation. Follow the [benchmark skill](../skills/protocol-visualizer-benchmark/SKILL.md)
and qualify a current-state worker protocol before claiming a worker percentage.
