import type {
  ContractState,
  ContractRelationship,
  ChainObservation,
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
        name: "Not installed in Kernel",
        label: "Not installed in Kernel",
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
}): string {
  return typeof contract.isEnabled === "boolean"
    ? `Kernel ${contract.isEnabled ? "active" : "inactive"}`
    : contract.category === "inactive-core"
      ? "Kernel inactive"
      : "External deployment";
}

export function getContractPalette(contract: {
  type?: string;
  category?: string;
  contractType?: string;
}): "kernel" | "module" | "policy" | "external" {
  const type =
    contract.type ??
    (contract.category === "inactive-core"
      ? contract.contractType?.toLowerCase()
      : undefined);
  return type === "kernel" || type === "module" || type === "policy"
    ? type
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
  if (state?.enablerCapability === "unsupported")
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

/** One address node can hold several distinct controls; field, scope and status retain separate edges. */
export function getRelationshipGraph(
  relationships: ContractRelationship[],
  chainId: number
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
  for (const relationship of relationships) {
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
    addresses.add(source);
    addresses.add(target);
    const pending = relationship.status === "pending";
    const name = relationship.kind.replace(/-/g, " ");
    const label = pending
      ? `Pending ${name}`
      : name.charAt(0).toUpperCase() + name.slice(1);
    const scope = [relationship.scope?.registry, relationship.scope?.token]
      .map((value) => value?.toLowerCase() ?? "")
      .join(":");
    const id = `${relationship.id}:${relationship.kind}:${relationship.status}:${scope}:${source}:${target}`;
    edges.set(id, { id, source, target, label, pending, relationship });
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
