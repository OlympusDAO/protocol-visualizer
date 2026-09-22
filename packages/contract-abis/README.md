# Contract ABIs

This package has the ABI of each live Olympus contract. The snapshot gateway
serves it at `/v1/abis`. Consumers such as the Olympus MCP server use it to
decode calls, events and reverts of the deployed addresses.

## Layout

```text
config.json                         scope, exclusions, labels, env.json ref
overrides/<chain>/<address>.json    manual ABIs, for contracts that Etherscan does not have
abis/manifest.json                  one entry for each deployment
abis/<chain>/<Label>.json           the ABI of one deployment
src/, scripts/, test/               the sync and check code
```

Do not edit the files in `abis/` manually. Run `pnpm abis:sync`.

## Sources

The registry is the union of two address sources:

- **olympus-v3 `env.json`:** each nonzero address in `current.<chain>.olympus`.
  The script reads the file from GitHub at the commit in `config.json`
  (`env.ref`). The `config`, `multisig` and `legacy` sections are out of scope,
  except the live `legacy` contracts in `excludedSections.legacy.keep`.
- **The Kernel index:** each enabled module and policy in the public snapshot
  gateway (`/v1/chains/{chainId}/protocol`). This adds older versions that the
  Kernel still has installed, for example Clearinghouse v1.0.

The script excludes these addresses automatically:

- An env.json policy that is not in the Kernel index, if `isActive()` returns
  false on-chain.
- An address in `config.json` `exclusions`, for example an address with no
  bytecode. Each exclusion has a reason.

## Labels

The script makes each label with these rules, in this order:

1. A label in `config.json` `labels` for the chain and address.
2. The last segment of the env.json path. For example, the label of
   `policies.RolesAdmin` is `RolesAdmin`.
3. For a contract that only the Kernel index has:
   `<ContractName>V<major>_<minor>`. The contract name comes from Etherscan.
   For example, `ClearinghouseV1_0`.

The version comes from `VERSION()` on-chain, else from the Kernel index.

If two or more deployments on one chain have the same contract name, each of
them that has a version gets the version in its label. For example, the three
mainnet Clearinghouses are `ClearinghouseV1_0`, `ClearinghouseV1_1` and
`ClearinghouseV1_2`. These deployments keep a plain label:

- A deployment with no version.
- An env.json name that already ends with a version, such as `OlympusRangeV2`.

A proxy counts under its own contract name, not the name of its
implementation.

If a Kernel contract has no version, or two addresses on one chain get the same
label, the sync stops. Add a label in `config.json` to correct it.

A label can change when a new version is deployed. Look up ABIs by address in
the manifest, not by file name.

## ABIs

The ABI of each address comes from Etherscan (`getsourcecode`) one time. The
script does not compare it with the local build of olympus-v3. A deployed
contract cannot change, so the stored ABI stays correct.

Proxies are the exception:

- A contract is a proxy if its EIP-1967 implementation slot is set. If the slot
  is empty, Etherscan must report an implementation and the contract must have
  a `fallback` function. This rule ignores factories that only store an
  implementation address.
- The ABI of a proxy is the implementation ABI, plus the entries that only the
  proxy has, such as upgrade functions.
- Each sync reads the implementation again. If it changed, the script gets the
  ABI again.

If Etherscan has no verified source for an address, the sync stops. Then add a
manual ABI:

```json
{
  "contractName": "OlympusLender",
  "reason": "The contract is not verified on Etherscan.",
  "abi": []
}
```

Save it as `overrides/<chain>/<lowercase address>.json`.

`abiHash` is the SHA-256 hash of the callable ABI. It ignores parameter names,
`internalType`, declaration order and the constructor. Two deployments with the
same `abiHash` have the same interface.

## Commands

| Command                  | Purpose                                                                | Network                    |
| ------------------------ | ---------------------------------------------------------------------- | -------------------------- |
| `pnpm abis:sync`         | Update the registry. Gets ABIs only for new addresses and changed proxies. | GitHub, gateway, Etherscan, RPC |
| `pnpm abis:sync --latest` | Move `env.ref` to the head of olympus-v3 `master`, then update.        | Same                       |
| `pnpm abis:check`        | Check that the manifest and the ABI files agree. Writes nothing.        | None                       |

`pnpm abis:sync` needs `ETHERSCAN_API_KEY`. It reads a `.env` file in this
package or in the repository root. It also needs `ENVIO_RPC_URL_<chainId>` for
each chain in `config.json` `chains`. The indexer uses the same variables. The
names in `chains` are the chain names in `env.json`. The chain ID of each name
comes from `viem/chains`.

## Automation

- The `build` job in `.github/workflows/ci.yml` runs `pnpm abis:check` and the
  package tests. It does not use the network, so a new contract on-chain cannot
  make an unrelated pull request fail.
- `.github/workflows/abis-sync.yml` runs `pnpm abis:sync --latest` on a
  `repository_dispatch` event of type `env-json-updated`, which olympus-v3
  sends when `src/scripts/env.json` changes on `master`. You can also start it
  manually. If the registry changed, it opens or updates one pull
  request from the `bot/abis-sync` branch. It needs the `ETHERSCAN_API_KEY`
  secret and one `ENVIO_RPC_URL_<chainId>` secret for each chain in
  `config.json` `chains`.
