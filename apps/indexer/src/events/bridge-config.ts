import type {
  BridgeConfiguration,
  EventProvenance,
} from "../../../../packages/snapshot-artifacts/src/index";
import chains from "../../../../packages/protocol-config/protocol-chains.json";
import externalChains from "../../../../packages/protocol-config/ccip-external-chains.json";
import { getContractName } from "../ContractNames";
import { contractId, controlTransitionId } from "./ids";
import type { ControlBlock } from "./control-state";
import type { ControlEvent, EnvioContext } from "./types";
import type { RelationshipField } from "./ownership";

export type BridgeContract = {
  address: string;
  startBlock: number;
  kind: "pool" | "bridge";
};
type Context = Pick<EnvioContext, "BridgeConfiguration" | "ControlTransition">;
export type BridgeReadResult =
  | { status: "success"; value: string }
  | { status: "unavailable"; reason: string };
export const ccipSelectors = [
  ...externalChains.map((chain) => chain.selector),
  ...chains.flatMap((chain) =>
    typeof chain.ccipSelector === "string" ? [chain.ccipSelector] : []
  ),
];

export function getBridgeContracts(
  chainId: number,
  fields: RelationshipField[]
): BridgeContract[] {
  return fields
    .filter(
      (field) =>
        field.getter === "owner" &&
        (field.kind === "pool-owner" ||
          getContractName(field.address as `0x${string}`, chainId) ===
            "CCIPCrossChainBridge")
    )
    .map((field) => ({
      address: field.address.toLowerCase(),
      startBlock: field.startBlock,
      kind: field.kind === "pool-owner" ? "pool" : "bridge",
    }));
}

const empty = (
  chainId: number,
  address: string,
  kind: BridgeContract["kind"]
): BridgeConfiguration => ({
  id: contractId(chainId, address),
  chainId,
  address: address.toLowerCase(),
  kind,
  configuration: null,
  selectors: [],
  observedAt: null,
  lastChange: null,
  verification: { outcome: "unperformed" },
});

/** Configuration logs invalidate the previous observation until the next completed checkpoint. */
export async function handleBridgeConfigurationEvent(
  context: Context,
  event: ControlEvent & { params: Record<string, unknown> },
  kind: BridgeContract["kind"]
) {
  const transitionId = controlTransitionId(event, "bridge-configuration");
  if (await context.ControlTransition.get(transitionId)) return;
  const id = contractId(event.chainId, event.srcAddress);
  const previous =
    (await context.BridgeConfiguration.get<BridgeConfiguration>(id)) ??
    empty(event.chainId, event.srcAddress, kind);
  const block: EventProvenance = {
    number: String(event.block.number),
    hash: event.block.hash,
    timestamp: String(event.block.timestamp),
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
  };
  if (
    previous.observedAt &&
    BigInt(block.number) <= BigInt(previous.observedAt.number)
  )
    throw new Error("configuration event precedes completed observation");
  if (
    previous.lastChange &&
    (BigInt(block.number) < BigInt(previous.lastChange.number) ||
      (block.number === previous.lastChange.number &&
        block.logIndex <= previous.lastChange.logIndex))
  )
    throw new Error("bridge events must replay in canonical log order");
  const selector =
    event.params.remoteChainSelector ?? event.params.dstChainSelector;
  const selectors = [
    ...new Set([
      ...previous.selectors,
      ...(selector == null ? [] : [String(selector)]),
    ]),
  ].sort();
  context.BridgeConfiguration.set({
    ...previous,
    lastChange: block,
    selectors,
    verification: { outcome: "unperformed" },
  });
  context.ControlTransition.set({
    id: transitionId,
    chainId: event.chainId,
    address: event.srcAddress.toLowerCase(),
    kind: "bridge-configuration",
    previousValue: null,
    value: { selector: selector == null ? null : String(selector) },
    blockNumber: BigInt(block.number),
    blockHash: block.hash,
    timestamp: BigInt(block.timestamp),
    transactionHash: block.transactionHash,
    logIndex: block.logIndex,
  });
}

export async function bridgeAnchorsCanonical(
  context: Context,
  chainId: number,
  block: ControlBlock,
  contracts: BridgeContract[],
  header: (number: string) => Promise<ControlBlock | undefined>
) {
  const headers = new Map<string, ControlBlock | undefined>([
    [block.number, block],
  ]);
  for (const contract of contracts) {
    const row = await context.BridgeConfiguration.get<BridgeConfiguration>(
      contractId(chainId, contract.address)
    );
    for (const anchor of [row?.observedAt, row?.lastChange]) {
      if (!anchor) continue;
      if (!headers.has(anchor.number))
        headers.set(anchor.number, await header(anchor.number));
      if (headers.get(anchor.number)?.hash !== anchor.hash) {
        if (row)
          context.BridgeConfiguration.set({
            ...row,
            verification: {
              outcome: "unavailable",
              block,
              reason: "Bridge configuration anchor is not canonical.",
            },
          });
        return false;
      }
    }
  }
  return true;
}

export async function completeBridgeConfigurations(
  context: Context,
  chainId: number,
  block: ControlBlock,
  contracts: BridgeContract[],
  read: (
    contract: BridgeContract,
    selectors: string[]
  ) => Promise<BridgeReadResult>
) {
  const selectors = new Set(ccipSelectors);
  // Pools enumerate selectors; bridge mappings do not. Read pools before trusted remotes.
  for (const contract of [...contracts].sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === "pool" ? -1 : 1
  )) {
    if (contract.startBlock > Number(block.number)) continue;
    const id = contractId(chainId, contract.address);
    const previous =
      (await context.BridgeConfiguration.get<BridgeConfiguration>(id)) ??
      empty(chainId, contract.address, contract.kind);
    const result = await read(
      contract,
      [...new Set([...selectors, ...previous.selectors])].sort()
    );
    if (result.status === "unavailable") {
      context.BridgeConfiguration.set({
        ...previous,
        verification: { outcome: "unavailable", block, reason: result.reason },
      });
      continue;
    }
    const configuration = JSON.parse(result.value) as NonNullable<
      BridgeConfiguration["configuration"]
    >;
    for (const route of configuration.routes) selectors.add(route.selector);
    context.BridgeConfiguration.set({
      ...previous,
      configuration,
      observedAt: block,
      verification: { outcome: "match", block },
    });
  }
}
