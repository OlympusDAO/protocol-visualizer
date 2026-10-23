import type {
  HeartTasks,
  PeriodicTask,
} from "../../../../packages/snapshot-artifacts/src/index";
import metadata from "../generated/contract-metadata.json";
import { getContractName, getContractStartBlock } from "../ContractNames";
import type { RelationshipField } from "./ownership";
import type { ControlStateEntity } from "./control-state";
import { applyControlTransition, setControlCapability } from "./control-state";
import { contractId, controlTransitionId } from "./ids";
import type { ControlGetterResult } from "./control-reads";
import type { ControlBlock } from "./control-state";
import type { ControlEvent, EnvioContext } from "./types";

type Context = Pick<
  EnvioContext,
  "HeartTasks" | "ContractStateSeed" | "ControlTransition"
>;
type TaskEvent = ControlEvent & {
  params: { task_: string; index_: bigint; customSelector_?: string };
};
const contracts = metadata as Record<
  string,
  Record<string, { functionSelectors: Record<string, { name: string }> }>
>;
const legacyTaskGetters: Record<string, string> = {
  ReserveMigrator: "locallyActive",
  Operator: "active",
  YieldRepurchaseFacility: "isShutdown",
};

const callProfiles = {
  ConvertibleDepositFacility: {
    selector: "0x61461954",
    calls: [["DEPOSIT_MANAGER", "claimYield(address,address,uint256)"]],
  },
  ReserveWrapper: {
    selector: "0x61461954",
    calls: [
      ["getSReserve", "deposit(uint256,address)"],
      ["getReserve", "approve(address,uint256)"],
    ],
  },
  ReserveMigrator: {
    selector: "0x8fd3ab80",
    calls: [
      ["migrator", "daiToUsds(address,uint256)"],
      ["sFrom", "redeem(uint256,address,address)"],
      ["sTo", "deposit(uint256,address)"],
      ["from", "approve(address,uint256)"],
      ["to", "approve(address,uint256)"],
    ],
  },
  Operator: {
    selector: "0x7159a618",
    calls: [
      ["auctioneer", "createMarket(bytes), closeMarket(uint256)"],
      ["callback", "whitelist(address,uint256)"],
    ],
  },
  YieldRepurchaseFacility: {
    selector: "0x0b9663db",
    calls: [
      ["auctioneer", "createMarket(bytes)"],
      ["ohm", "burn(uint256)"],
      ["sReserve", "redeem(uint256,address,address)"],
      ["reserve", "approve(address,uint256)"],
    ],
  },
  EmissionManager: {
    selector: "0x61461954",
    calls: [
      ["cdAuctioneer", "setAuctionParameters(uint256,uint256,uint256)"],
      ["bondAuctioneer", "createMarket(bytes)"],
    ],
  },
} as const;
const taskProfiles: Record<
  number,
  Record<string, keyof typeof callProfiles>
> = {
  "1": {
    "0xebde552d851dd6dfd3d360c596d3f4af6e5f9678": "ConvertibleDepositFacility",
    "0x986b99579bec7b990331474b66ccdb94fa2419f5": "ReserveMigrator",
    "0xca6cd4f0a0033f8c20cf68d6df277e7001a386f9": "ReserveWrapper",
    "0x6417f206a0a6628da136c0faa39026d0134d2b52": "Operator",
    "0x271e35a8555a62f6ba76508e85dfd76d580b0692": "YieldRepurchaseFacility",
    "0xa61b846d5d8b757e3d541e0e4f80390e28f0b6ff": "EmissionManager",
  },
  "11155111": {
    "0x0be69702e83f06a027e6841b614f6946d1265441": "ConvertibleDepositFacility",
    "0x46a01ae30571855fbb5988eed9d116aa2a3f2377": "ReserveWrapper",
    "0xa386b4f750f493a6c9f33fbbf8702718b785969a": "ReserveWrapper",
    "0x8b92a1dea210b7b7516443b52fdf5dae677e93b0": "ReserveMigrator",
    "0xd5405c517631b15c5814fdb7e612ba4c86fc2f75": "Operator",
    "0xf8abe1d9502bbcad4576433490d851d03c22a6b4": "YieldRepurchaseFacility",
    "0x5261fba7b50aa22b19b9edf939b771d109de991f": "EmissionManager",
    "0x84785e392bfd02f97a9b84f85d86dec11933ef81": "EmissionManager",
    "0x9dc1920981fcf74786c838bf6f6c3683a8713576": "EmissionManager",
  },
};

export function getTaskCallFields(chainId: number): RelationshipField[] {
  const explorer =
    chainId === 11155111
      ? "https://sepolia.etherscan.io"
      : "https://etherscan.io";
  return Object.entries(taskProfiles[chainId] ?? {}).flatMap(
    ([address, name]) => {
      const profile = callProfiles[name];
      const startBlock = getContractStartBlock(
        address as `0x${string}`,
        chainId
      );
      if (startBlock === undefined)
        throw new Error(
          `Missing task call creation anchor: ${chainId}:${address}`
        );
      return profile.calls.map(([getter, callSignature]) => ({
        address,
        getter,
        callSignature,
        callSelector: profile.selector,
        kind: "task-call",
        startBlock,
        coverage: `getter-only: target observed at completed checkpoints. Potential conditional calls from ${name}'s configured entry point in verified source ${explorer}/address/${address}#code; not an execution trace.`,
      }));
    }
  );
}

export function getLegacyTaskGetter(chainId: number, address: string) {
  const functions = Object.values(
    contracts[String(chainId)]?.[address.toLowerCase()]?.functionSelectors ?? {}
  ).map((fn) => fn.name);
  if (functions.includes("isEnabled")) return undefined;
  const name = getContractName(address as `0x${string}`, chainId);
  const getter = legacyTaskGetters[name];
  return getter && functions.includes(getter) ? getter : undefined;
}

export function getLegacyTaskContracts(chainId: number) {
  return Object.keys(contracts[String(chainId)] ?? {}).flatMap((address) => {
    const getter = getLegacyTaskGetter(chainId, address);
    const startBlock = getContractStartBlock(address as `0x${string}`, chainId);
    return getter && startBlock !== undefined
      ? [{ address, getter, startBlock }]
      : [];
  });
}

export async function handleLegacyTaskEvent(
  context: EnvioContext,
  event: ControlEvent,
  enabled: boolean
) {
  await applyControlTransition(context, event, "enabled", enabled);
  await setControlCapability(
    context,
    event.chainId,
    event.srcAddress,
    "unsupported"
  );
}

export async function observeLegacyTaskState(
  context: Pick<EnvioContext, "ContractState" | "ContractStateSeed">,
  chainId: number,
  address: string,
  block: ControlBlock,
  getter: string,
  result: ControlGetterResult
) {
  const previous = await context.ContractState.get<ControlStateEntity>(
    contractId(chainId, address)
  );
  const success = result.status === "success";
  const observed = success
    ? getter === "isShutdown"
      ? result.value === "false"
      : result.value === "true"
    : null;
  const enabled =
    getter === "locallyActive"
      ? (previous?.enabled ?? observed)
      : (observed ?? previous?.enabled ?? null);
  if (success && !previous?.seed)
    context.ContractStateSeed.set({
      id: `${contractId(chainId, address)}:${block.hash}:${getter}`,
      chainId,
      address,
      getter,
      boundary: block,
      value: result.value,
    });
  context.ContractState.set({
    id: contractId(chainId, address),
    chainId,
    address,
    ...previous,
    enablerCapability: "unsupported",
    enabled,
    seed: previous?.seed ?? (success ? block : null),
    lastChange: previous?.lastChange ?? null,
    indexedThrough:
      success || getter === "locallyActive"
        ? block
        : (previous?.indexedThrough ?? null),
    enablementGetter: getter,
    enablementCoverage:
      getter === "locallyActive"
        ? "Activated/Deactivated events replayed and checked against locallyActive()."
        : `${getter === "isShutdown" ? "Enabled when isShutdown() is false; Shutdown events replayed. " : ""}Getter-only observation; intervening changes are not inferred.`,
    verification: success
      ? {
          outcome: enabled === observed ? "match" : "mismatch",
          block,
          getterValue: result.value,
        }
      : { outcome: "unavailable", block, reason: result.reason },
  });
}

export function getPeriodicTaskManagers(chainId: number) {
  return Object.entries(contracts[String(chainId)] ?? {})
    .filter(([, contract]) =>
      Object.values(contract.functionSelectors).some(
        (fn) => fn.name === "getPeriodicTasks"
      )
    )
    .map(([address]) => {
      const startBlock = getContractStartBlock(
        address as `0x${string}`,
        chainId
      );
      if (startBlock === undefined)
        throw new Error(
          `Missing periodic task manager creation anchor: ${chainId}:${address}`
        );
      return { address, startBlock };
    });
}

function unknown(chainId: number, address: string): HeartTasks {
  return {
    id: contractId(chainId, address),
    chainId,
    address: address.toLowerCase(),
    tasks: null,
    seed: null,
    lastChange: null,
    indexedThrough: null,
    verification: { outcome: "unperformed" },
  };
}
const taskValue = (tasks: PeriodicTask[]) =>
  JSON.stringify(tasks.map(({ address, selector }) => ({ address, selector })));

export async function handlePeriodicTaskEvent(
  context: Context,
  event: TaskEvent,
  action: "PeriodicTaskAdded" | "PeriodicTaskRemoved"
) {
  const id = contractId(event.chainId, event.srcAddress);
  const transitionId = controlTransitionId(event, "periodic-tasks");
  if (await context.ControlTransition.get(transitionId)) return;
  const state =
    (await context.HeartTasks.get<HeartTasks>(id)) ??
    unknown(event.chainId, event.srcAddress);
  if (state.seed && BigInt(event.block.number) <= BigInt(state.seed.number))
    throw new Error("event precedes completed seed boundary");
  if (
    state.lastChange &&
    (BigInt(event.block.number) < BigInt(state.lastChange.number) ||
      (String(event.block.number) === state.lastChange.number &&
        event.logIndex <= state.lastChange.logIndex))
  )
    throw new Error("periodic task events must replay in canonical log order");
  const tasks = state.tasks === null ? null : [...state.tasks];
  const index = Number(event.params.index_);
  const task = {
    address: event.params.task_.toLowerCase(),
    selector: event.params.customSelector_?.toLowerCase() ?? "0x00000000",
  };
  if (tasks) {
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index > tasks.length ||
      (action === "PeriodicTaskRemoved" &&
        tasks[index]?.address !== task.address)
    )
      throw new Error("periodic task event does not match indexed order");
    if (action === "PeriodicTaskAdded") tasks.splice(index, 0, task);
    else tasks.splice(index, 1);
  }
  const lastChange = {
    number: String(event.block.number),
    hash: event.block.hash,
    timestamp: String(event.block.timestamp),
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
  };
  context.HeartTasks.set({
    ...state,
    tasks,
    lastChange,
    verification: { outcome: "unperformed" },
  });
  context.ControlTransition.set({
    id: transitionId,
    chainId: event.chainId,
    address: state.address,
    kind: "periodic-tasks",
    previousValue: { tasks: state.tasks },
    value: { action, index, task },
    blockNumber: BigInt(event.block.number),
    blockHash: event.block.hash,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
  });
}

export async function heartTaskAnchorsCanonical(
  context: Context,
  chainId: number,
  block: ControlBlock,
  addresses: string[],
  readBlock: (number: string) => Promise<ControlBlock | undefined>
): Promise<boolean> {
  const headers = new Map<string, ControlBlock | undefined>([
    [block.number, block],
  ]);
  for (const address of addresses) {
    const state = await context.HeartTasks.get<HeartTasks>(
      contractId(chainId, address)
    );
    if (!state) continue;
    for (const anchor of [state.seed, state.lastChange]) {
      if (!anchor) continue;
      if (!headers.has(anchor.number))
        headers.set(anchor.number, await readBlock(anchor.number));
      if (headers.get(anchor.number)?.hash !== anchor.hash) {
        context.HeartTasks.set({
          ...state,
          verification: {
            outcome: "unavailable",
            block,
            reason:
              "Periodic task anchor is not confirmed on the observed canonical chain.",
          },
        });
        return false;
      }
    }
  }
  return true;
}

export async function completeHeartTasks(
  context: Context,
  chainId: number,
  address: string,
  block: ControlBlock,
  result: ControlGetterResult
) {
  const state =
    (await context.HeartTasks.get<HeartTasks>(contractId(chainId, address))) ??
    unknown(chainId, address);
  if (result.status === "unavailable") {
    context.HeartTasks.set({
      ...state,
      indexedThrough: block,
      verification: { outcome: "unavailable", block, reason: result.reason },
    });
    return;
  }
  const observed: PeriodicTask[] = JSON.parse(result.value);
  const tasks = (state.tasks ?? observed).map((task) => {
    const fn =
      contracts[String(chainId)]?.[task.address]?.functionSelectors[
        task.selector
      ];
    return fn ? { ...task, signature: `${fn.name}()` } : task;
  });
  const seed = state.seed ?? (state.tasks === null ? block : null);
  const observedValue = taskValue(observed);
  const outcome = taskValue(tasks) === observedValue ? "match" : "mismatch";
  context.HeartTasks.set({
    ...state,
    tasks,
    seed,
    indexedThrough: block,
    verification: { outcome, block, getterValue: observedValue },
  });
  if (state.tasks === null)
    context.ContractStateSeed.set({
      id: `${state.id}:${block.hash}:getPeriodicTasks`,
      chainId,
      address: state.address,
      getter: "getPeriodicTasks",
      boundary: block,
      value: observedValue,
    });
}
