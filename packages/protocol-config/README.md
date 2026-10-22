# Protocol Config

Shared protocol visualizer runtime configuration.

`other-contracts.json` lists contracts outside the Kernel's module/policy graph
that the ownership and enablement views need. Each entry has a chain, address,
name, and a verified creation block when available. It contains no observed
ownership or enabled state. Core labels remain in `apps/indexer/src/ContractNames.ts`.
Source revisions and receipt evidence are recorded in `docs/deployment-coverage.md`.

`protocol-chains.json` is the source of truth for public snapshot chains. The
frontend uses it for chain labels and explorer URLs, the publisher uses it to
choose and name generated snapshots, and the gateway uses it to allowlist
`/v1/chains/{chainId}/protocol` routes.

`SNAPSHOT_CHAIN_IDS` can narrow a publisher run to a subset, but it must not add
chains that are absent from this file.

Each chain has an `environment` (`production` or `testnet`) and `availability`
(`indexed` or `historical`). Publisher defaults and monitor readiness include
indexed chains only. The frontend lists every catalog chain, with recorded
deployments instead of snapshot requests for historical networks.
