import metadata from "../generated/contract-metadata.json";
import otherContracts from "../../../../packages/protocol-config/other-contracts.json";
import { getContractName, getContractStartBlock } from "../ContractNames";
import {
  relationshipId,
  type RelationshipField,
  type RelationshipState,
} from "./ownership";
import type { ProcessedContractData } from "../services/contracts/types";
import type { EnvioContext } from "./types";

const poolNames = new Set([
  "CCIPLockReleaseTokenPool",
  "CCIPBurnMintTokenPool",
]);
const references: Record<string, [string, string][]> = {
  CCIPTokenPoolConfig: [["pool", "configured-pool"]],
  CCIPTokenPoolConfigTimelock: [["config", "configured-policy"]],
  CoolerV2Migrator: [["COOLERV2", "cooler-reference"]],
  CoolerV2Composites: [["COOLER", "cooler-reference"]],
  CCIPCrossChainBridge: [["OHM", "token-reference"]],
  LZCrossChainBridge: [["OHM", "token-reference"]],
};
export function getCcipRegistry(chainId: number) {
  const registry = otherContracts.find(
    (entry) => entry.chainId === chainId && entry.name === "TokenAdminRegistry"
  );
  const token = otherContracts.find(
    (entry) => entry.chainId === chainId && entry.name === "OHM"
  );
  return registry && token
    ? { address: registry.address, token: token.address }
    : undefined;
}

const ownedNames = new Set([
  "CCIPCrossChainBridge",
  "LZCrossChainBridge",
  "CoolerV2Composites",
  "CoolerV2Migrator",
  "ConvertibleDepositAuctioneerLimitOrders",
  "ConvertibleDepositActivator",
  "MigrationProposalHelper",
]);
export function getRelationshipFields(
  chainId: number,
  firstIndexedBlock = 0
): RelationshipField[] {
  const fields: RelationshipField[] = [];
  const known = new Map(
    otherContracts
      .filter((entry) => entry.chainId === chainId && !entry.labelOnly)
      .map((entry) => [entry.address, entry.name])
  );
  for (const address of Object.keys(
    (metadata as Record<string, Record<string, unknown>>)[String(chainId)] ?? {}
  )) {
    const name = getContractName(address as `0x${string}`, chainId);
    if (
      !known.has(address) &&
      (ownedNames.has(name) || poolNames.has(name) || references[name])
    )
      known.set(address, name);
  }
  for (const [address, name] of known) {
    const add = (getter: string, kind: string = getter, coverage?: string) => {
      const startBlock = getContractStartBlock(
        address as `0x${string}`,
        chainId
      );
      if (startBlock === undefined)
        throw new Error(
          `Missing verified ${getter} creation anchor: ${chainId}:${address}`
        );
      const field = {
        address,
        startBlock,
        getter,
        kind,
        ...(coverage ? { coverage } : {}),
      };
      fields.push(field);
      return field;
    };
    if (ownedNames.has(name)) add("owner");
    for (const [getter, kind] of references[name] ?? [])
      add(
        getter,
        kind,
        `Immutable contract reference from ${getter}(); seeded at a completed canonical block.`
      );
    if (poolNames.has(name) || name === "TokenAdminRegistry") {
      const kind =
        name === "TokenAdminRegistry" ? "registry-owner" : "pool-owner";
      add("owner", kind);
      add(
        "newOwner",
        kind,
        "Pending owner is event-only: no public getter; earlier nominations are unknown until a transfer request or acceptance is replayed."
      );
    }
    if (name === "TokenAdminRegistry") {
      const registry = getCcipRegistry(chainId);
      if (registry) {
        for (const getter of ["administrator", "newAdministrator", "getPool"]) {
          const field: RelationshipField = add(
            `${getter}:${registry.token}`,
            getter === "getPool" ? "registered-pool" : "token-admin"
          );
          field.scope = { registry: address, token: registry.token };
          if (getter === "getPool")
            field.inventoryPools = [...known]
              .filter(([, name]) => poolNames.has(name))
              .map(([address]) => address);
        }
      }
    }
    if (name === "OHM" || name === "Staking")
      add("authority", "authority-reference");
    if (name === "OlympusAuthority") {
      for (const role of ["governor", "guardian", "policy", "vault"]) {
        add(role);
        add(`new${role.charAt(0).toUpperCase()}${role.slice(1)}`, role);
      }
    }
    if (name === "sOHM" && (chainId === 1 || chainId === 11155111))
      add("stakingContract", "staking-contract");
    if (name === "gOHM" && (chainId === 1 || chainId === 11155111))
      add(
        "approved",
        "legacy-minter",
        "getter-only: gOHM.migrate changes approved without a change event; observed at checkpoints"
      );
  }
  const chainMetadata =
    (metadata as Record<string, Record<string, ProcessedContractData>>)[
      String(chainId)
    ] ?? {};
  for (const [address, contract] of Object.entries(chainMetadata)) {
    for (const getter of contract.addressGetters ?? []) {
      const functionContext = Object.values(contract.functionSelectors).find(
        (fn) => fn.canonicalSignature === `${getter}()`
      )?.documentation;
      if (!functionContext?.source) continue;
      if (
        fields.some(
          (field) =>
            field.address.toLowerCase() === address && field.getter === getter
        )
      )
        continue;
      fields.push({
        address,
        getter,
        kind: "contract-reference",
        startBlock:
          getContractStartBlock(address as `0x${string}`, chainId) ??
          firstIndexedBlock,
        coverage:
          chainId === 1 &&
          address === "0xdb591ea2e5db886da872654d58f6cc584b68e7cc" &&
          ["ltvOracle", "treasuryBorrower"].includes(getter)
            ? "Source-verified reference change events; state seeded at the first completed canonical checkpoint with deployed code."
            : "getter-only: verified ABI address getter observed at completed canonical checkpoints; intervening changes and earlier state are not inferred",
      });
    }
  }
  return fields;
}

export async function getObservedAuthorityFields(
  context: Pick<EnvioContext, "ContractRelationship">,
  chainId: number,
  fields: RelationshipField[]
): Promise<RelationshipField[]> {
  const observed = new Map(
    fields.map((field) => [
      relationshipId(chainId, field.address, field.getter),
      field,
    ])
  );
  for (const consumer of fields.filter(
    (field) => field.getter === "authority"
  )) {
    const reference = await context.ContractRelationship.get<RelationshipState>(
      relationshipId(chainId, consumer.address, "authority")
    );
    if (!reference?.value || /^0x0{40}$/.test(reference.value)) continue;
    for (const role of ["governor", "guardian", "policy", "vault"]) {
      for (const getter of [
        role,
        `new${role.charAt(0).toUpperCase()}${role.slice(1)}`,
      ]) {
        const id = relationshipId(chainId, reference.value, getter);
        if (!observed.has(id))
          observed.set(id, {
            address: reference.value,
            startBlock: Number(reference.provenance.number),
            getter,
            kind: role,
            coverage: `Authority discovered at reference block ${reference.provenance.number}; earlier state is seeded at a completed checkpoint`,
          });
      }
    }
  }
  return [...observed.values()];
}

export async function getObservedPoolFields(
  context: Pick<EnvioContext, "ContractRelationship" | "ControlTransition">,
  chainId: number,
  fields: RelationshipField[]
): Promise<RelationshipField[]> {
  const observed = new Map(
    fields.map((field) => [
      relationshipId(chainId, field.address, field.getter),
      field,
    ])
  );
  for (const field of fields.filter(
    (field) => field.kind === "registered-pool"
  )) {
    const reference = await context.ContractRelationship.get<RelationshipState>(
      relationshipId(chainId, field.address, field.getter)
    );
    const registrations = await context.ControlTransition.getWhere<{
      value: { address: string | null };
      blockNumber: bigint;
    }>({
      chainId: { _eq: chainId },
      address: { _eq: field.address.toLowerCase() },
      kind: { _eq: `relationship:${field.getter}` },
    });
    const pools = new Map<string, number>();
    for (const row of registrations) {
      const address = row.value.address;
      if (address && !/^0x0{40}$/.test(address))
        pools.set(
          address,
          Math.min(pools.get(address) ?? Infinity, Number(row.blockNumber))
        );
    }
    if (
      reference?.value &&
      !/^0x0{40}$/.test(reference.value) &&
      !pools.has(reference.value)
    )
      pools.set(reference.value, Number(reference.provenance.number));
    for (const [address, startBlock] of pools)
      for (const getter of ["owner", "newOwner"]) {
        const id = relationshipId(chainId, address, getter);
        if (!observed.has(id))
          observed.set(id, {
            address,
            startBlock,
            getter,
            kind: "pool-owner",
            coverage:
              getter === "newOwner"
                ? "Pending owner is event-only: no public getter; earlier nominations are unknown until replayed."
                : `Pool discovered at registration block ${startBlock}; earlier state is seeded at a completed checkpoint`,
          });
      }
  }
  return [...observed.values()];
}
