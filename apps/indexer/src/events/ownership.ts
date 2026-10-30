import type { FunctionContext } from "../../../../packages/snapshot-artifacts/src/index";
import type { ControlGetterResult } from "./control-reads";
import type { ControlBlock } from "./control-state";
import { contractId, controlTransitionId } from "./ids";
import type { ControlEvent, EnvioContext } from "./types";

export type RelationshipField = {
  callSelector?: string;
  callSignature?: string;
  address: string;
  startBlock: number;
  getter: string;
  kind: string;
  coverage?: string;
  scope?: { registry?: string; token?: string };
  inventoryPools?: string[];
};
type Provenance = ControlBlock & {
  transactionHash?: string;
  logIndex?: number;
};
type ChangeProvenance = ControlBlock & {
  transactionHash: string;
  logIndex: number;
};
export type RelationshipState = {
  callSelector?: string;
  callSignature?: string;
  id: string;
  chainId: number;
  subject: string;
  getter: string;
  kind: string;
  value: string | null;
  source: string;
  target: string | null;
  status: "current" | "pending" | "reference" | "unset";
  provenance: Provenance;
  seed: ControlBlock | null;
  lastChange: ChangeProvenance | null;
  indexedThrough: ControlBlock | null;
  verification: {
    outcome: "unperformed" | "match" | "mismatch" | "unavailable";
    block?: ControlBlock;
    getterValue?: string;
    reason?: string;
  };
  coverage?: string;
  functionContext?: FunctionContext;
  targetCode?: "present" | "absent";
  scope?: { registry?: string; token?: string };
};
type Context = Pick<
  EnvioContext,
  | "ContractRelationship"
  | "ContractStateSeed"
  | "ControlTransition"
  | "ChainObservation"
>;
type RelationshipEvent = ControlEvent & { params: Record<string, unknown> };
const zero = `0x${"0".repeat(40)}`;
const nonzero = (value: string | null | undefined) =>
  value != null && value !== zero;
export const relationshipId = (
  chainId: number,
  address: string,
  getter: string
) => `${contractId(chainId, address)}:${getter}`;
const isPending = (getter: string) => getter.startsWith("new");
const reference = (kind: string) =>
  [
    "contract-reference",
    "module-dependency",
    "task-call",
    "authority-reference",
    "registered-pool",
    "configured-policy",
    "configured-pool",
    "cooler-reference",
    "token-reference",
  ].includes(kind);
const currentGetter = (getter: string) =>
  getter.charAt(3).toLowerCase() + getter.slice(4);
const poolDiscrepancy = (
  field: RelationshipField,
  value: string | null | undefined
) => {
  if (
    value == null ||
    !field.inventoryPools?.length ||
    field.inventoryPools.includes(value.toLowerCase())
  )
    return undefined;
  return value.toLowerCase() === zero
    ? `OHM is unregistered; inventory pools: ${field.inventoryPools.join(", ")}.`
    : `Registered pool ${value.toLowerCase()} differs from inventory pool ${field.inventoryPools.join(", ")}.`;
};

async function present(
  context: Context,
  state: RelationshipState
): Promise<RelationshipState> {
  let status: RelationshipState["status"] = reference(state.kind)
    ? "reference"
    : isPending(state.getter)
      ? "pending"
      : "current";
  if (!nonzero(state.value)) status = "unset";
  if (!reference(state.kind) && isPending(state.getter)) {
    const current = await context.ContractRelationship.get<RelationshipState>(
      relationshipId(state.chainId, state.subject, currentGetter(state.getter))
    );
    if (current?.value === state.value) status = "unset";
  }
  if (reference(state.kind) && state.value === state.subject) status = "unset";
  return {
    ...state,
    status,
    source:
      !reference(state.kind) && status !== "unset" && state.value !== null
        ? state.value
        : state.subject,
    target:
      status === "unset"
        ? null
        : reference(state.kind)
          ? state.value
          : state.kind === "token-admin"
            ? (state.scope?.token ?? state.subject)
            : state.subject,
  };
}

async function writeField(
  context: Context,
  chainId: number,
  field: RelationshipField,
  value: string,
  provenance: Provenance,
  event?: ControlEvent
): Promise<void> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error("relationship getter must return an address");
  const id = relationshipId(chainId, field.address, field.getter);
  const previous =
    await context.ContractRelationship.get<RelationshipState>(id);
  const coverage =
    poolDiscrepancy(field, value) ?? field.coverage ?? previous?.coverage;
  const transitionId =
    event && controlTransitionId(event, `relationship:${field.getter}`);
  if (transitionId && (await context.ControlTransition.get(transitionId)))
    return;
  if (
    event &&
    previous?.seed &&
    BigInt(event.block.number) <= BigInt(previous.seed.number)
  )
    throw new Error("event precedes completed seed boundary");
  if (
    event &&
    previous?.lastChange &&
    (BigInt(event.block.number) < BigInt(previous.lastChange.number) ||
      (String(event.block.number) === previous.lastChange.number &&
        event.logIndex <= previous.lastChange.logIndex))
  )
    throw new Error("relationship events must replay in canonical log order");
  const state = await present(context, {
    id,
    chainId,
    subject: field.address.toLowerCase(),
    getter: field.getter,
    kind: field.kind,
    ...(field.callSignature ? { callSignature: field.callSignature } : {}),
    ...(field.callSelector ? { callSelector: field.callSelector } : {}),
    value: value.toLowerCase(),
    source: field.address.toLowerCase(),
    target: null,
    status: "unset",
    provenance,
    seed: previous?.seed ?? (event ? null : provenance),
    lastChange: event ? provenanceFor(event) : (previous?.lastChange ?? null),
    indexedThrough: previous?.indexedThrough ?? null,
    verification: { outcome: "unperformed" },
    ...(previous?.functionContext
      ? { functionContext: previous.functionContext }
      : {}),
    ...(previous?.targetCode && previous.value === value.toLowerCase()
      ? { targetCode: previous.targetCode }
      : {}),
    ...(coverage ? { coverage } : {}),
    ...((field.scope ?? previous?.scope)
      ? { scope: field.scope ?? previous?.scope }
      : {}),
  });
  context.ContractRelationship.set(state);
  if (event && transitionId)
    context.ControlTransition.set({
      id: transitionId,
      chainId,
      address: state.subject,
      kind: `relationship:${field.getter}`,
      previousValue: { address: previous?.value ?? null },
      value: { address: state.value },
      blockNumber: BigInt(event.block.number),
      blockHash: event.block.hash,
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    });
  if (!event && !previous?.value)
    context.ContractStateSeed.set({
      id: `${id}:${provenance.hash}`,
      chainId,
      address: state.subject,
      boundary: provenance,
      getter: field.getter,
      value: state.value,
    });
  if (!reference(field.kind) && !isPending(field.getter)) {
    const pendingGetter = `new${field.getter.charAt(0).toUpperCase()}${field.getter.slice(1)}`;
    const pending = await context.ContractRelationship.get<RelationshipState>(
      relationshipId(chainId, field.address, pendingGetter)
    );
    if (pending)
      context.ContractRelationship.set(await present(context, pending));
  }
}
const provenanceFor = (event: ControlEvent): ChangeProvenance => ({
  number: String(event.block.number),
  hash: event.block.hash,
  timestamp: String(event.block.timestamp),
  transactionHash: event.transaction.hash,
  logIndex: event.logIndex,
});
async function eventField(
  context: Context,
  event: RelationshipEvent,
  getter: string,
  kind: string,
  value: unknown,
  scope?: RelationshipField["scope"]
) {
  if (typeof value !== "string")
    throw new Error("relationship event lacks address");
  await writeField(
    context,
    event.chainId,
    {
      address: event.srcAddress,
      startBlock: 0,
      getter,
      kind,
      ...(scope ? { scope } : {}),
    },
    value,
    provenanceFor(event),
    event
  );
}
export async function handleOwnershipEvent(
  context: Context,
  event: RelationshipEvent
) {
  await eventField(context, event, "owner", "owner", event.params.newOwner);
}
/** Chainlink ConfirmedOwner uses from/to and does not expose its private pending owner. */
export async function handleChainlinkOwnershipEvent(
  context: Context,
  event: RelationshipEvent,
  action: "OwnershipTransferRequested" | "OwnershipTransferred",
  kind: "pool-owner" | "registry-owner"
) {
  if (action === "OwnershipTransferRequested")
    await eventField(context, event, "newOwner", kind, event.params.to);
  else {
    await eventField(context, event, "owner", kind, event.params.to);
    await eventField(context, event, "newOwner", kind, zero);
  }
}

export async function handleRegistryEvent(
  context: Context,
  event: RelationshipEvent,
  action:
    | "AdministratorTransferRequested"
    | "AdministratorTransferred"
    | "PoolSet",
  token: string
) {
  if (
    typeof event.params.token !== "string" ||
    event.params.token.toLowerCase() !== token.toLowerCase()
  )
    return;
  token = token.toLowerCase();
  const scope = { registry: event.srcAddress.toLowerCase(), token };
  if (action === "PoolSet")
    await eventField(
      context,
      event,
      `getPool:${token}`,
      "registered-pool",
      event.params.newPool,
      scope
    );
  else if (action === "AdministratorTransferRequested")
    await eventField(
      context,
      event,
      `newAdministrator:${token}`,
      "token-admin",
      event.params.newAdmin,
      scope
    );
  else {
    await eventField(
      context,
      event,
      `administrator:${token}`,
      "token-admin",
      event.params.newAdmin,
      scope
    );
    await eventField(
      context,
      event,
      `newAdministrator:${token}`,
      "token-admin",
      zero,
      scope
    );
  }
}
export async function handleAuthorityEvent(
  context: Context,
  event: RelationshipEvent,
  role: "governor" | "guardian" | "policy" | "vault",
  action: "Pushed" | "Pulled"
) {
  if (action === "Pulled" || event.params._effectiveImmediately === true)
    await eventField(context, event, role, role, event.params.to);
  // Constructor pushes report the initial holder without assigning new*. Ordinary immediate pushes emit from=to.
  const constructorPush =
    action === "Pushed" &&
    event.params._effectiveImmediately === true &&
    event.params.from === zero &&
    event.params.to !== zero;
  if (!constructorPush)
    await eventField(
      context,
      event,
      `new${role.charAt(0).toUpperCase()}${role.slice(1)}`,
      role,
      event.params.to
    );
}
export async function handleAuthorityReference(
  context: Context,
  event: RelationshipEvent
) {
  await eventField(
    context,
    event,
    "authority",
    "authority-reference",
    event.params.authority
  );
}
export async function handleStakingReference(
  context: Context,
  event: RelationshipEvent
) {
  await eventField(
    context,
    event,
    "stakingContract",
    "staking-contract",
    event.params.stakingContract
  );
}

export async function handleContractReference(
  context: Context,
  event: RelationshipEvent,
  getter: string,
  value: unknown
) {
  await eventField(context, event, getter, "contract-reference", value);
}

/** Preflight the whole relationship inventory before another control family advances chain observation. */
export async function relationshipAnchorsCanonical(
  context: Context,
  chainId: number,
  block: ControlBlock,
  fields: RelationshipField[],
  readCanonicalBlock: (number: string) => Promise<ControlBlock | undefined>
): Promise<boolean> {
  const headers = new Map<string, ControlBlock | undefined>([
    [block.number, block],
  ]);
  for (const field of fields.filter(
    (field) => field.startBlock <= Number(block.number)
  )) {
    const state = await context.ContractRelationship.get<RelationshipState>(
      relationshipId(chainId, field.address, field.getter)
    );
    const anchor = state?.value != null ? state.provenance : undefined;
    if (!state || !anchor) continue;
    if (!headers.has(anchor.number))
      headers.set(anchor.number, await readCanonicalBlock(anchor.number));
    if (headers.get(anchor.number)?.hash !== anchor.hash) {
      context.ContractRelationship.set({
        ...state,
        verification: {
          outcome: "unavailable",
          block,
          reason:
            "Indexed relationship anchor is not confirmed on the observed canonical chain.",
        },
      });
      return false;
    }
  }
  return true;
}

/** Envio runs checkpoints after all logs. Getter-only fields explicitly disclose their missing event coverage. */
export async function completeRelationshipBlock(
  context: Context,
  chainId: number,
  block: ControlBlock,
  fields: RelationshipField[],
  read: (address: string, getter: string) => Promise<ControlGetterResult>,
  readCanonicalBlock: (number: string) => Promise<ControlBlock | undefined>
): Promise<boolean> {
  if (
    !(await relationshipAnchorsCanonical(
      context,
      chainId,
      block,
      fields,
      readCanonicalBlock
    ))
  )
    return false;
  for (const field of fields.filter(
    (field) => field.startBlock <= Number(block.number)
  )) {
    const id = relationshipId(chainId, field.address, field.getter);
    let state = await context.ContractRelationship.get<RelationshipState>(id);
    const result = await read(field.address, field.getter);
    if (
      result.status === "success" &&
      (state?.value == null || field.coverage?.startsWith("getter-only"))
    ) {
      await writeField(context, chainId, field, result.value, block);
      state = await context.ContractRelationship.get<RelationshipState>(id);
    }
    if (!state) {
      state = {
        id,
        chainId,
        subject: field.address.toLowerCase(),
        getter: field.getter,
        kind: field.kind,
        value: null,
        source: field.address.toLowerCase(),
        target: null,
        status: "unset",
        provenance: block,
        seed: null,
        lastChange: null,
        indexedThrough: null,
        verification: { outcome: "unperformed" },
        ...(field.coverage ? { coverage: field.coverage } : {}),
        ...(field.scope ? { scope: field.scope } : {}),
      };
    }
    context.ContractRelationship.set({
      ...(await present(context, state)),
      ...(field.callSignature ? { callSignature: field.callSignature } : {}),
      ...(field.callSelector ? { callSelector: field.callSelector } : {}),
      indexedThrough: block,
      ...(result.status === "success"
        ? {
            functionContext: result.functionContext ?? state.functionContext,
            targetCode:
              state.value === result.value.toLowerCase()
                ? (result.targetCode ?? state.targetCode)
                : state.targetCode,
          }
        : {}),
      ...(field.inventoryPools?.length
        ? {
            coverage: poolDiscrepancy(field, state.value) ?? field.coverage,
          }
        : {}),
      verification:
        result.status === "unavailable"
          ? { outcome: "unavailable", block, reason: result.reason }
          : {
              outcome:
                state.value === null
                  ? "unperformed"
                  : state.value === result.value.toLowerCase()
                    ? "match"
                    : "mismatch",
              block,
              getterValue: result.value.toLowerCase(),
            },
    });
  }
  context.ChainObservation.set({
    id: String(chainId),
    chainId,
    indexedThrough: block,
  });
  return true;
}
