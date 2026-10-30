import { contractId } from "./ids";
import {
  applyControlTransition,
  completeControlBlock,
  seedControlState,
  verifyControlState,
  type ControlBlock,
  type ControlStateEntity,
} from "./control-state";
import type { ControlGetterResult } from "./control-reads";
import type { ControlEvent, EnvioContext } from "./types";

export type EnablerContract = {
  address: string;
  startBlock: number;
  dialect: "v1" | "v2";
};
type EnablementEvent = ControlEvent & {
  params?: { by?: string; enable?: boolean; data?: string; at?: bigint };
};

/** V2 emits a legacy log immediately before Transition; only Transition changes indexed state. */
export async function handleEnablementEvent(
  context: EnvioContext,
  event: EnablementEvent,
  name: "Enabled" | "Disabled" | "Transition",
  dialect: EnablerContract["dialect"]
): Promise<void> {
  if (dialect === "v2" && name !== "Transition") return;
  if (name === "Transition") {
    if (dialect !== "v2" || typeof event.params?.enable !== "boolean") return;
    await applyControlTransition(
      context,
      event,
      "enabled",
      event.params.enable,
      {
        caller: event.params.by?.toLowerCase(),
        data: event.params.data,
        lastTransitionAt: event.params.at?.toString(),
      }
    );
  } else {
    await applyControlTransition(context, event, "enabled", name === "Enabled");
  }
}

/** Envio invokes this after all logs in the block, including constructor logs. */
export async function completeEnablementBlock(
  context: EnvioContext,
  chainId: number,
  block: ControlBlock,
  contracts: EnablerContract[],
  read: (address: string) => Promise<ControlGetterResult>,
  readCanonicalBlock: (number: string) => Promise<ControlBlock | undefined>
): Promise<boolean> {
  const deployed = contracts.filter(
    (contract) => contract.startBlock <= Number(block.number)
  );
  if (
    !(await controlAnchorsCanonical(
      context,
      chainId,
      block,
      deployed.map((contract) => contract.address),
      readCanonicalBlock
    ))
  )
    return false;
  const results = new Map<string, ControlGetterResult>();
  for (const { address } of deployed) {
    const result = await read(address);
    results.set(address, result);
    await seedControlState(context, chainId, address, block, result);
    const state = await context.ContractState.get<ControlStateEntity>(
      contractId(chainId, address)
    );
    if (state && state.enablerCapability !== "supported")
      context.ContractState.set({ ...state, enablerCapability: "supported" });
  }
  await completeControlBlock(
    context,
    chainId,
    block,
    deployed.map(({ address }) => address)
  );
  for (const [address, result] of results)
    await verifyControlState(context, chainId, address, block, result);
  return true;
}

export async function controlAnchorsCanonical(
  context: EnvioContext,
  chainId: number,
  block: ControlBlock,
  addresses: string[],
  readCanonicalBlock: (number: string) => Promise<ControlBlock | undefined>
): Promise<boolean> {
  const canonicalBlocks = new Map<string, ControlBlock | undefined>([
    [block.number, block],
  ]);
  for (const address of addresses) {
    const state = await context.ContractState.get<ControlStateEntity>(
      contractId(chainId, address)
    );
    if (!state) continue;
    const anchors = [
      state.seed,
      state.lastChange,
      ...(state.enablementGetter && state.enablementGetter !== "locallyActive"
        ? [state.indexedThrough]
        : []),
    ];
    for (const anchor of anchors) {
      if (!anchor) continue;
      if (!canonicalBlocks.has(anchor.number))
        canonicalBlocks.set(
          anchor.number,
          await readCanonicalBlock(anchor.number)
        );
      if (canonicalBlocks.get(anchor.number)?.hash !== anchor.hash) {
        context.ContractState.set({
          ...state,
          verification: {
            outcome: "unavailable",
            block,
            reason:
              "Indexed state anchor is not confirmed on the observed canonical chain.",
          },
        });
        return false;
      }
    }
  }
  return true;
}
