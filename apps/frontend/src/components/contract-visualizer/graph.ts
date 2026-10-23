import otherContracts from "../../../../../packages/protocol-config/other-contracts.json";
import type {
  ContractState,
  ContractRelationship,
  ChainObservation,
  FunctionContext,
  HeartTasks,
} from "../../../../../packages/snapshot-artifacts/src/index";
import type { Node } from "reactflow";

export function getPreservedGraphNodes(
  next: Node[],
  previous: Node[],
  previousLayout: Node[] = previous
): Node[] {
  const inactiveById = new Map(
    next.map((node) => [node.id, node.data.kernelInactive])
  );
  const group = next.find((node) => node.type === "group");
  const oldGroup = previousLayout.find((node) => node.type === "group");
  const inactiveIds = (nodes: Node[]) =>
    nodes
      .filter((node) => node.data.kernelInactive)
      .map((node) => node.id)
      .sort()
      .join(":");
  const sameGroup =
    group?.position.x === oldGroup?.position.x &&
    group?.position.y === oldGroup?.position.y &&
    group?.style?.width === oldGroup?.style?.width &&
    group?.style?.height === oldGroup?.style?.height &&
    inactiveIds(next) === inactiveIds(previousLayout);
  return previous.filter(
    (node) =>
      node.type !== "group" &&
      node.data.kernelInactive === inactiveById.get(node.id) &&
      (!node.data.kernelInactive || sameGroup)
  );
}

export function groupInactiveContracts(
  active: Node[],
  inactive: Node[]
): Node[] {
  if (!inactive.length) return active;
  const columns = Math.min(3, inactive.length);
  const cellWidth = Math.max(220, ...inactive.map(getGraphNodeWidth)) + 40;
  const x =
    Math.max(
      0,
      ...active.map((node) => node.position.x + getGraphNodeWidth(node))
    ) + 160;
  const y = Math.min(100, ...active.map((node) => node.position.y));
  return [
    {
      id: "kernel-inactive-group",
      type: "group",
      position: { x, y },
      data: {
        name: "Removed from Kernel",
        label: "Removed from Kernel",
      },
      selectable: false,
      focusable: false,
      draggable: false,
      connectable: false,
      zIndex: -1,
      style: {
        width: columns * cellWidth + 48,
        height: Math.ceil(inactive.length / columns) * 160 + 72,
        padding: "16px 24px",
        textAlign: "left",
        fontSize: 14,
        color: "#64748b",
        background: "rgba(241,245,249,0.6)",
        border: "1px dashed #cbd5e1",
        pointerEvents: "none",
      },
    },
    ...active,
    ...inactive.map((node, index) => ({
      ...node,
      position: {
        x: x + 24 + (index % columns) * cellWidth,
        y: y + 48 + Math.floor(index / columns) * 160,
      },
    })),
  ];
}

export function getGraphContractName(contract: {
  name: string;
  version?: string | null;
}): string {
  return contract.version
    ? `${contract.name} (${contract.version})`
    : contract.name;
}

export function getContractNodeWidth(contract: {
  name: string;
  version?: string | null;
}): number {
  return Math.min(
    360,
    Math.max(180, getGraphContractName(contract).length * 8 + 48)
  );
}

export function getGraphNodeWidth(node: Node): number {
  return typeof node.style?.width === "number"
    ? node.style.width
    : (node.width ?? 180);
}

export function getKernelLabel(contract: {
  isEnabled?: boolean;
  category?: string;
}): string | null {
  return typeof contract.isEnabled === "boolean"
    ? `Kernel ${contract.isEnabled ? "active" : "inactive"}`
    : contract.category === "inactive-core"
      ? "Kernel inactive"
      : null;
}

export function getContractDeploymentLabel(contract: {
  name?: string;
}): string {
  const name = contract.name ?? "";
  if (/\bMS\b|Multisig/.test(name)) return "Multisig";
  if (/Proposal(?:Helper|Checker)$|^ConvertibleDepositActivator$/.test(name))
    return "Proposal helper";
  if (
    /^(?:CCIPCrossChainBridge|LZCrossChainBridge|CrossChainBridge|CoolerV2Composites|CoolerV2Migrator|ConvertibleDepositAuctioneerLimitOrders|CCIPLockReleaseTokenPool|CCIPBurnMintTokenPool|V1Migrator)$/.test(
      name
    )
  )
    return "Periphery";
  if (/^(?:OHM|sOHM|gOHM|Staking|Minter|OlympusAuthority)$/.test(name))
    return "Olympus contract";
  return "External deployment";
}

export function getContractPalette(contract: {
  name?: string;
  type?: string;
  category?: string;
  contractType?: string;
}): "kernel" | "module" | "policy" | "external" | "periphery" | "assignee" {
  const type =
    contract.type ??
    (contract.category === "inactive-core"
      ? contract.contractType?.toLowerCase()
      : undefined);
  if (type === "kernel" || type === "module" || type === "policy") return type;
  const label = getContractDeploymentLabel(contract);
  return label === "Multisig"
    ? "assignee"
    : label === "Periphery"
      ? "periphery"
      : "external";
}

export function getEnablementPresentation(
  state?: ContractState,
  observation?: ChainObservation | null
) {
  const badge =
    state?.enabled == null
      ? null
      : state.enabled
        ? "Contract enabled"
        : "Contract disabled";
  const details: string[] = [];
  const notices: string[] = [];
  if (state?.enablementGetter)
    details.push(
      `Task-local state from ${state.enablementGetter}(). ${state.enablementCoverage ?? ""}`
    );
  else if (state?.enablerCapability === "unsupported")
    details.push("Verified ABI does not implement IEnabler.");
  else if (state?.enabled == null)
    details.push(
      "IEnabler state is unknown; no successful seed or indexed transition establishes it."
    );
  if (state?.seed)
    details.push(`Seeded at block ${state.seed.number} (${state.seed.hash}).`);
  if (state?.lastChange)
    details.push(
      `Last transition at block ${state.lastChange.number}, transaction ${state.lastChange.transactionHash}, log ${state.lastChange.logIndex}.`
    );
  if (state?.lastChange?.caller)
    details.push(
      `Transition caller ${state.lastChange.caller}; payload ${state.lastChange.data ?? "0x"}; lastTransitionAt ${state.lastChange.lastTransitionAt ?? state.lastChange.timestamp}.`
    );
  if (
    state?.lastChange &&
    (!state.indexedThrough ||
      BigInt(state.lastChange.number) > BigInt(state.indexedThrough.number))
  )
    notices.push(
      "Latest transition awaits a completed verification checkpoint."
    );
  if (state?.indexedThrough)
    details.push(
      `Enablement indexed through block ${state.indexedThrough.number} (${state.indexedThrough.hash}).`
    );
  if (
    observation &&
    (!state?.indexedThrough ||
      BigInt(state.indexedThrough.number) <
        BigInt(observation.indexedThrough.number))
  )
    notices.push(
      `Enablement coverage is behind chain observation block ${observation.indexedThrough.number}.`
    );
  const verification = state?.verification;
  let warning: string | null = null;
  if (verification?.outcome === "mismatch") {
    warning = `Verification mismatch: indexed ${state?.enabled}, getter ${verification.getterValue} at block ${verification.block?.number} (${verification.block?.hash}).`;
    details.push(warning);
  } else if (verification?.outcome === "unavailable") {
    notices.push(
      `Getter verification unavailable${verification.block ? ` at block ${verification.block.number}` : ""}; established indexed state is retained.`
    );
  } else if (verification?.outcome === "match") {
    details.push(
      `Getter matches indexed state at block ${verification.block?.number}.`
    );
  }
  return { badge, warning, details, notices };
}

export function refreshGraph<
  T extends { id: string; position: { x: number; y: number } },
>(
  next: T[],
  previous: T[],
  selected: string | null
): { nodes: T[]; selectedNode: string | null } {
  const normalize = (id: string) =>
    id.startsWith("0x") || id.startsWith("assignee-") ? id.toLowerCase() : id;
  const positions = new Map(
    previous.map((node) => [normalize(node.id), node.position])
  );
  const nodes = new Map<string, T>();
  for (const node of next) {
    const id = normalize(node.id);
    if (!nodes.has(id))
      nodes.set(id, {
        ...node,
        id,
        position: positions.get(id) ?? node.position,
      });
  }
  const selectedNode =
    selected && nodes.has(normalize(selected)) ? normalize(selected) : null;
  return { nodes: [...nodes.values()], selectedNode };
}

export function getRelationshipGraph(
  relationships: ContractRelationship[],
  chainId: number,
  periodicTasks: HeartTasks[] = []
) {
  const addresses = new Set<string>();
  const edges = new Map<
    string,
    {
      id: string;
      source: string;
      target: string;
      label: string;
      pending: boolean;
      relationship: ContractRelationship;
    }
  >();
  const taskRelationships: ContractRelationship[] = periodicTasks.flatMap(
    (list) => {
      const provenance = list.lastChange ?? list.seed ?? list.indexedThrough;
      if (!provenance) return [];
      return (list.tasks ?? []).map((task, index) => ({
        id: `${list.id}:periodic-task:${index}`,
        chainId: list.chainId,
        kind: "periodic-task",
        callSelector:
          task.selector === "0x00000000" ? "0x61461954" : task.selector,
        source: list.address,
        subject: list.address,
        target: task.address,
        status: "reference",
        getter: "getPeriodicTasks",
        provenance,
        functionContext: {
          signature: `${index + 1}. ${task.selector === "0x00000000" ? "execute()" : (task.signature ?? task.selector)}`,
        },
        verification: list.verification,
        indexedThrough: list.indexedThrough,
        coverage:
          "Configured invocation order, including disabled tasks. Tasks decide whether to perform work; this is not an execution trace.",
      }));
    }
  );
  const configuredCalls = relationships.filter(
    (relationship) =>
      relationship.kind !== "task-call" ||
      taskRelationships.some(
        (task) =>
          task.chainId === relationship.chainId &&
          task.target === relationship.source.toLowerCase() &&
          task.callSelector === relationship.callSelector
      )
  );
  for (const relationship of [...configuredCalls, ...taskRelationships]) {
    if (
      relationship.chainId !== chainId ||
      relationship.status === "unset" ||
      !relationship.target
    )
      continue;
    const source = relationship.source.toLowerCase();
    const target = relationship.target.toLowerCase();
    if (
      [source, target].some(
        (address) =>
          !/^0x[0-9a-f]{40}$/.test(address) || /^0x0{40}$/.test(address)
      ) ||
      source === target
    )
      continue;
    const path = getRelationshipPath(relationship);
    for (const address of path) addresses.add(address);
    const graphTarget = path[1] ?? target;
    const pending = relationship.status === "pending";
    const name = relationship.kind.replace(/-/g, " ");
    const getter =
      relationship.status === "reference"
        ? relationship.getter?.split(":")[0]
        : undefined;
    let tokenName = "Token";
    let label: string;
    if (relationship.kind === "token-admin") {
      const token = relationship.scope?.token?.toLowerCase();
      if (token)
        tokenName =
          otherContracts.find(
            (contract) =>
              contract.chainId === chainId &&
              contract.address.toLowerCase() === token
          )?.name ?? `${token.slice(0, 6)}…${token.slice(-4)}`;
      label = `${pending ? "Pending " : ""}${tokenName} admin`;
    } else if (pending) label = `Pending ${name}`;
    else if (relationship.callSignature)
      label = relationship.callSignature.replace(/\([^)]*\)/g, "()");
    else if (getter)
      label =
        relationship.functionContext?.signature ??
        `${getter}(${relationship.scope?.token ? "address" : ""})`;
    else label = name.charAt(0).toUpperCase() + name.slice(1);
    const scope = [relationship.scope?.registry, relationship.scope?.token]
      .map((value) => value?.toLowerCase() ?? "")
      .join(":");
    const id = `${relationship.id}:${relationship.kind}:${relationship.status}:${scope}:${source}:${target}`;
    edges.set(id, {
      id,
      source,
      target: graphTarget,
      label,
      pending,
      relationship,
    });
    if (relationship.kind === "token-admin" && path.length === 3) {
      const contextId = `registry-token:${chainId}:${graphTarget}:${target}`;
      edges.set(contextId, {
        id: contextId,
        source: graphTarget,
        target,
        label: `Token configuration · ${tokenName}`,
        pending: false,
        relationship,
      });
    }
  }
  const graphEdges = [...edges.values()];
  const parallel = new Map<string, typeof graphEdges>();
  for (const edge of graphEdges) {
    const key = `${edge.source}:${edge.target}`;
    const group = parallel.get(key) ?? [];
    group.push(edge);
    parallel.set(key, group);
  }
  return {
    addresses: [...addresses],
    edges: [...parallel.values()].flatMap((group) =>
      group.map((edge, index) => ({
        ...edge,
        labelOffset: (index - (group.length - 1) / 2) * 18,
      }))
    ),
  };
}

export function getFunctionTooltip(functions: FunctionContext[]): string {
  return functions
    .map((fn) =>
      [fn.signature, fn.source?.match === "exact" ? fn.notice : undefined]
        .filter(Boolean)
        .join(" — ")
    )
    .join("\n");
}

export function getRelationshipPath(
  relationship: ContractRelationship
): string[] {
  return [
    relationship.source,
    ...(relationship.kind === "token-admin"
      ? [relationship.scope?.registry]
      : []),
    relationship.target,
  ]
    .filter((address): address is string =>
      Boolean(
        address &&
          /^0x[0-9a-fA-F]{40}$/.test(address) &&
          !/^0x0{40}$/i.test(address)
      )
    )
    .map((address) => address.toLowerCase())
    .filter(
      (address, index, array) => index === 0 || address !== array[index - 1]
    );
}

export function getRelationshipCurve(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  lane = 0
) {
  const bend = Math.max(48, Math.abs(targetX - sourceX) / 2);
  if (Math.abs(targetY - sourceY) < 50) lane -= 160;
  return {
    path: `M ${sourceX},${sourceY} C ${sourceX + bend},${sourceY + lane} ${targetX - bend},${targetY + lane} ${targetX},${targetY}`,
    labelX: (sourceX + targetX) / 2,
    labelY: (sourceY + targetY) / 2 + lane * 0.75 - 12,
  };
}
