# Contract ABIs

This package has the ABI of each live Olympus contract. Consumers such as the
Olympus MCP server use it to decode calls, events and reverts of the deployed
addresses. The snapshot gateway serves it:

| Route                               | Response                                        |
| ----------------------------------- | ----------------------------------------------- |
| `/v1/abis`                          | The contracts of each chain: label and address. |
| `/v1/abis/{chainId}/{address}`      | The ABI and the metadata of one contract.       |
| `/v1/abis/{chainId}/labels/{label}` | The same, found by label.                       |

The gateway does not serve the exclusions or the env.json ref. They are only in
`abis/manifest.json`.

`pnpm indexer:metadata` also reads this registry. It gets the ABI of each
address from `abis/manifest.json` and writes the function selectors to
`apps/indexer/src/generated/contract-metadata.json`. It skips an address that
the registry does not have; then the indexer resolves that address at runtime.
See the "Contract Metadata" section of `apps/indexer/README.md`.

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

The version comes from `VERSION()` on-chain, else from the Kernel index. A
Kernel contract that has no version takes the start of its address instead, for
example `EmissionManager_0x50f441a3`. This happens with contracts from before
`VERSION()` existed.

An env.json label never gets a version. Thus the label of the current contract
does not change when the Kernel adds or removes another version. For example,
the mainnet Clearinghouse in env.json is `Clearinghouse`. The other
Clearinghouses that the Kernel still has are `ClearinghouseV1_0` and
`ClearinghouseV1_2`.

If two addresses on one chain get the same label, the sync stops. Add a label
in `config.json` to correct it.

When env.json gets a new address for a name, the label moves to the new
address. To identify one deployment, use its address.

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
  proxy has, such as upgrade functions. If Etherscan has no verified source for
  the proxy, the ABI is only the implementation ABI.
- Each sync reads the implementation again, also for a proxy with a manual ABI.
  If it changed, the script gets the ABI again.

If Etherscan has no verified source for an address without an EIP-1967 slot,
or for the implementation of a proxy, the sync stops. Then add a manual ABI:

```json
{
  "contractName": "OlympusLender",
  "reason": "The contract is not verified on Etherscan.",
  "abi": []
}
```

Save it as `overrides/<chain>/<lowercase address>.json`. For a proxy, use the
address of the proxy, and add `implementation`: the address of the
implementation that the ABI describes. The sync finds a proxy only from its
EIP-1967 slot or its verified source. For a proxy that the sync cannot find, do
not add `implementation`. After an upgrade, the sync does not use the manual
ABI of the old implementation. It gets the ABI of the new implementation from
Etherscan. If Etherscan has no verified source for it, the sync stops until you
update `implementation` and `abi`.

`abiHash` is the SHA-256 hash of the callable ABI. It ignores parameter names,
`internalType`, declaration order and the constructor. Two deployments with the
same `abiHash` have the same interface.

## Commands

| Command                  | Purpose                                                                | Network                    |
| ------------------------ | ---------------------------------------------------------------------- | -------------------------- |
| `pnpm abis:sync`         | Update the registry. Gets ABIs only for new addresses and changed proxies. | GitHub, gateway, Etherscan, RPC |
| `pnpm abis:sync --latest` | Move `env.ref` to the last olympus-v3 `master` commit that changed env.json, then update. | Same |
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
- `.github/workflows/abis-sync.yml` runs `pnpm abis:sync --latest` every day,
  and on manual dispatch. The daily run also finds the changes that env.json
  does not show, such as a policy that the Kernel activates, or a proxy
  upgrade. If the registry changed, it opens or updates one pull request from
  the `bot/abis-sync` branch with `peter-evans/create-pull-request`. It needs
  the `ETHERSCAN_API_KEY` secret and one `ENVIO_RPC_URL_<chainId>` secret for
  each chain in `config.json` `chains`.
- A push with `GITHUB_TOKEN` does not start `on: pull_request` workflows.
  Thus, after each push to `bot/abis-sync`, the sync workflow starts
  `ci.yml` on that branch with `workflow_dispatch`. The checks of that run
  show on the pull request.
