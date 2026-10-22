import metadata from "../generated/contract-metadata.json";
import otherContracts from "../../../../packages/protocol-config/other-contracts.json";
import { getContractStartBlock } from "../ContractNames";
import type { EnablerContract } from "./enabler";

const verifiedMetadata = metadata as Record<
  string,
  Record<string, { functionSelectors: Record<string, { name: string }> }>
>;
// These deployed ABIs are source-verified but absent from the core function metadata.
// CoolerComposites and CoolerV2Migrator implement IEnabler without ERC165.
const peripheryNames = new Set([
  "CoolerV2Composites",
  "CoolerV2Migrator",
  "CCIPCrossChainBridge",
]);

export function getEnablerCapability(
  chainId: number,
  address: string
): "supported" | "unsupported" | "unknown" {
  const functions =
    verifiedMetadata[String(chainId)]?.[address.toLowerCase()]
      ?.functionSelectors;
  if (functions && Object.keys(functions).length > 0)
    return Object.values(functions).some((fn) => fn.name === "isEnabled")
      ? "supported"
      : "unsupported";
  return otherContracts.some(
    (entry) =>
      entry.chainId === chainId &&
      entry.address === address.toLowerCase() &&
      peripheryNames.has(entry.name)
  )
    ? "supported"
    : "unknown";
}

export function getEnablerContracts(chainId: number): EnablerContract[] {
  const addresses = new Set([
    ...Object.keys(verifiedMetadata[String(chainId)] ?? {}),
    ...otherContracts
      .filter(
        (entry) => entry.chainId === chainId && peripheryNames.has(entry.name)
      )
      .map((entry) => entry.address),
  ]);
  return [...addresses]
    .filter((address) => getEnablerCapability(chainId, address) === "supported")
    .map((address) => {
      const startBlock = getContractStartBlock(
        address as `0x${string}`,
        chainId
      );
      if (startBlock === undefined)
        throw new Error(
          `Missing verified IEnabler creation anchor: ${chainId}:${address}`
        );
      const functions = Object.values(
        verifiedMetadata[String(chainId)]?.[address]?.functionSelectors ?? {}
      );
      return {
        address,
        startBlock,
        dialect: functions.some((fn) => fn.name === "lastTransitionAt")
          ? "v2"
          : "v1",
      };
    });
}
