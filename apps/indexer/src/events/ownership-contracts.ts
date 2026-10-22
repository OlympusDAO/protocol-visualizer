import metadata from "../generated/contract-metadata.json";
import otherContracts from "../../../../packages/protocol-config/other-contracts.json";
import { getContractName, getContractStartBlock } from "../ContractNames";
import {
  relationshipId,
  type RelationshipField,
  type RelationshipState,
} from "./ownership";
import type { EnvioContext } from "./types";

const ownedNames = new Set([
  "CCIPCrossChainBridge",
  "LZCrossChainBridge",
  "CoolerV2Composites",
  "CoolerV2Migrator",
  "ConvertibleDepositAuctioneerLimitOrders",
  "ConvertibleDepositActivator",
  "MigrationProposalHelper",
]);
export function getRelationshipFields(chainId: number): RelationshipField[] {
  const fields: RelationshipField[] = [];
  const known = new Map(
    otherContracts
      .filter((entry) => entry.chainId === chainId)
      .map((entry) => [entry.address, entry.name])
  );
  for (const address of Object.keys(
    (metadata as Record<string, Record<string, unknown>>)[String(chainId)] ?? {}
  )) {
    const name = getContractName(address as `0x${string}`, chainId);
    if (!known.has(address) && ownedNames.has(name)) known.set(address, name);
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
      fields.push({
        address,
        startBlock,
        getter,
        kind,
        ...(coverage ? { coverage } : {}),
      });
    };
    if (ownedNames.has(name)) add("owner");
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
  return fields;
}

/** AuthorityUpdated registers new event sources immediately. Its first completed checkpoint seeds earlier unknown state. */
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
