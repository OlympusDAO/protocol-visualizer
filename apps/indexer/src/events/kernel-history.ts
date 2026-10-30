import metadata from "../generated/contract-metadata.json";
import {
  getContractName,
  getContractType,
  getContractVersion,
  getContractStartBlock,
} from "../ContractNames";
import { contractId } from "./ids";
import type { ControlBlock } from "./control-state";
import type { EnvioContext } from "./types";

export function getCoreContracts(chainId: number) {
  return Object.keys(
    (metadata as Record<string, Record<string, unknown>>)[chainId] ?? {}
  ).flatMap((address) => {
    const target = address as `0x${string}`;
    const type = getContractType(target, chainId);
    return type === "module" || type === "policy"
      ? [
          {
            address: target,
            name: getContractName(target, chainId),
            version: getContractVersion(target, chainId) ?? undefined,
            contractType:
              type === "module" ? ("MODULE" as const) : ("POLICY" as const),
            startBlock: getContractStartBlock(target, chainId),
          },
        ]
      : [];
  });
}

export async function seedCoreContracts(
  context: EnvioContext,
  chainId: number,
  firstIndexedBlock: number,
  block: ControlBlock,
  contracts: ReturnType<typeof getCoreContracts>,
  hasCode: (address: `0x${string}`) => Promise<boolean>
) {
  for (const contract of contracts) {
    if (
      contract.startBlock !== undefined &&
      BigInt(contract.startBlock) > BigInt(block.number)
    )
      continue;
    const id = contractId(chainId, contract.address);
    if ((await context.Contract.get(id)) || !(await hasCode(contract.address)))
      continue;
    // Completed creation blocks include all constructor and Kernel action logs.
    const observedFromBirth =
      contract.startBlock !== undefined &&
      firstIndexedBlock <= contract.startBlock &&
      BigInt(block.number) === BigInt(contract.startBlock);
    context.Contract.set({
      id,
      chainId,
      address: contract.address,
      name: contract.name,
      version: contract.version,
      contractType: contract.contractType,
      isEnabled: false,
      kernelHistory: observedFromBirth ? "never-installed" : "unknown",
      lastUpdatedTimestamp: BigInt(block.timestamp),
      lastUpdatedBlockNumber: BigInt(block.number),
    });
  }
}
