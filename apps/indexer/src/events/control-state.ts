import { contractId, controlTransitionId } from "./ids";
import type { ControlEvent, EnvioContext } from "./types";
import type { ControlGetterResult } from "./control-reads";

export type ControlBlock = { number: string; hash: string; timestamp: string };
type ControlProvenance = ControlBlock & {
  transactionHash: string;
  logIndex: number;
  caller?: string;
  data?: string;
  lastTransitionAt?: string;
};
export type ControlStateEntity = {
  enablementGetter?: string;
  enablementCoverage?: string;
  id: string;
  chainId: number;
  address: string;
  enablerCapability: "unknown" | "supported" | "unsupported";
  enabled: boolean | null;
  seed: ControlBlock | null;
  lastChange: ControlProvenance | null;
  indexedThrough: ControlBlock | null;
  verification: {
    outcome: "unperformed" | "match" | "mismatch" | "unavailable";
    block?: ControlBlock;
    getterValue?: string;
    reason?: string;
  };
};

type ControlContext = Pick<
  EnvioContext,
  | "ContractState"
  | "ContractStateSeed"
  | "ControlTransition"
  | "ChainObservation"
>;
const unknownState = (
  chainId: number,
  address: string
): ControlStateEntity => ({
  id: contractId(chainId, address),
  chainId,
  address: address.toLowerCase(),
  enablerCapability: "unknown",
  enabled: null,
  seed: null,
  lastChange: null,
  indexedThrough: null,
  verification: { outcome: "unperformed" },
});

export async function setControlCapability(
  context: ControlContext,
  chainId: number,
  address: string,
  capability: ControlStateEntity["enablerCapability"]
): Promise<void> {
  if (capability === "unknown") return;
  const state =
    (await context.ContractState.get<ControlStateEntity>(
      contractId(chainId, address)
    )) ?? unknownState(chainId, address);
  context.ContractState.set({ ...state, enablerCapability: capability });
}

/** A seed describes the end of a completed block; only later blocks may replay over it. */
export async function seedControlState(
  context: ControlContext,
  chainId: number,
  address: string,
  block: ControlBlock,
  result: ControlGetterResult
): Promise<void> {
  const state =
    (await context.ContractState.get<ControlStateEntity>(
      contractId(chainId, address)
    )) ?? unknownState(chainId, address);
  if (state.enabled !== null) return;
  if (result.status === "unavailable") {
    context.ContractState.set({
      ...state,
      verification: { outcome: "unavailable", block, reason: result.reason },
    });
    return;
  }
  if (result.value !== "true" && result.value !== "false")
    throw new Error("isEnabled seed must be boolean");
  context.ContractStateSeed.set({
    id: `${state.id}:${block.hash}:isEnabled`,
    chainId,
    address: state.address,
    boundary: block,
    getter: "isEnabled",
    value: result.value,
  });
  context.ContractState.set({
    ...state,
    enabled: result.value === "true",
    enablerCapability: "supported",
    seed: block,
    verification: { outcome: "unperformed" },
  });
}

export async function applyControlTransition(
  context: ControlContext,
  event: ControlEvent,
  kind: "enabled",
  value: boolean,
  metadata: { caller?: string; data?: string; lastTransitionAt?: string } = {}
): Promise<void> {
  const id = controlTransitionId(event, kind);
  if (await context.ControlTransition.get(id)) return;
  const state =
    (await context.ContractState.get<ControlStateEntity>(
      contractId(event.chainId, event.srcAddress)
    )) ?? unknownState(event.chainId, event.srcAddress);
  if (state.seed && BigInt(event.block.number) <= BigInt(state.seed.number))
    throw new Error("event precedes completed seed boundary");
  if (
    state.lastChange &&
    (BigInt(event.block.number) < BigInt(state.lastChange.number) ||
      (String(event.block.number) === state.lastChange.number &&
        event.logIndex <= state.lastChange.logIndex))
  )
    throw new Error("control events must replay in canonical log order");
  const provenance: ControlProvenance = {
    ...metadata,
    number: String(event.block.number),
    hash: event.block.hash,
    timestamp: String(event.block.timestamp),
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
  };
  context.ControlTransition.set({
    id,
    chainId: event.chainId,
    address: state.address,
    kind,
    previousValue: { enabled: state.enabled },
    value: { enabled: value, ...metadata },
    blockNumber: BigInt(event.block.number),
    blockHash: event.block.hash,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
  });
  context.ContractState.set({
    ...state,
    enablerCapability: "supported",
    enabled: value,
    lastChange: provenance,
    verification: { outcome: "unperformed" },
  });
}

/** Called only after every event in this canonical block has completed. No getter or publication timestamp advances coverage. */
export async function completeControlBlock(
  context: ControlContext,
  chainId: number,
  block: ControlBlock,
  addresses: string[]
): Promise<void> {
  for (const address of addresses) {
    const state = await context.ContractState.get<ControlStateEntity>(
      contractId(chainId, address)
    );
    if (state) context.ContractState.set({ ...state, indexedThrough: block });
  }
  context.ChainObservation.set({
    id: String(chainId),
    chainId,
    indexedThrough: block,
  });
}

export async function verifyControlState(
  context: ControlContext,
  chainId: number,
  address: string,
  block: ControlBlock,
  result: ControlGetterResult
): Promise<void> {
  const state = await context.ContractState.get<ControlStateEntity>(
    contractId(chainId, address)
  );
  if (!state) return;
  if (
    state.indexedThrough?.hash !== block.hash ||
    state.indexedThrough.number !== block.number
  )
    throw new Error(
      "verification requires the completed indexed-through block"
    );
  context.ContractState.set({
    ...state,
    verification:
      result.status === "unavailable"
        ? { outcome: "unavailable", block, reason: result.reason }
        : {
            outcome:
              state.enabled === null
                ? "unperformed"
                : String(state.enabled) === result.value
                  ? "match"
                  : "mismatch",
            block,
            getterValue: result.value,
          },
  });
}
