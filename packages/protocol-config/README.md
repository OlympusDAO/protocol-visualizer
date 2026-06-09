# Protocol Config

Shared protocol visualizer runtime configuration.

`protocol-chains.json` is the source of truth for public snapshot chains. The
frontend uses it for chain labels and explorer URLs, the publisher uses it to
choose and name generated snapshots, and the gateway uses it to allowlist
`/v1/chains/{chainId}/protocol` routes.

`SNAPSHOT_CHAIN_IDS` can narrow a publisher run to a subset, but it must not add
chains that are absent from this file.
