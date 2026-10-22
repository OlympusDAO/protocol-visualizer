import type { Edge, Node } from "reactflow";
import { getContractNodeWidth } from "./graph";

export const SUBSYSTEMS = [
  { id: "core", name: "Kernel & modules" },
  { id: "cooler", name: "Cooler & lending" },
  { id: "bridging", name: "Cross-chain bridges" },
  { id: "deposits", name: "Deposits & reserves" },
  { id: "monetary", name: "Monetary policy" },
  { id: "governance", name: "Governance & configuration" },
  { id: "tokens", name: "Tokens & staking" },
  { id: "roles", name: "Roles" },
  { id: "other", name: "Other contracts" },
  { id: "inactive", name: "Not installed in Kernel" },
];
export type ConnectionKind = "permission" | "control" | "reference";
export type ConnectionFilters = Record<ConnectionKind, boolean>;

export function getSubsystem(node: Node): string | null {
  if (node.data.kernelInactive) return "inactive";
  if (node.id.startsWith("role-")) return "roles";
  if (node.data.assigneeAddress || /\bMS\b|Multisig/.test(node.data.name))
    return null;
  if (["kernel", "module"].includes(node.data.contractType)) return "core";
  const name = node.data.name as string;
  if (/Cooler|Clearinghouse|BLVault/.test(name)) return "cooler";
  if (/CCIP|CrossChainBridge|TokenAdminRegistry|LayerZero/.test(name))
    return "bridging";
  if (/Deposit|Reserve/.test(name)) return "deposits";
  if (
    /Bond|Emission|Heart|Operator|Distributor|YieldRepurchase|TreasuryCustodian|pOLY/.test(
      name
    )
  )
    return "monetary";
  if (
    /RolesAdmin|PriceConfig|RegistryAdmin|Authority|ProposalHelper|Emergency|Governor/.test(
      name
    )
  )
    return "governance";
  if (/^(OHM|sOHM|gOHM|Staking)$/.test(name)) return "tokens";
  return "other";
}

function getConnectionKind(edge: Edge): ConnectionKind {
  return edge.data?.kind ?? "permission";
}

export function getArchitectureView(
  inputNodes: Node[],
  inputEdges: Edge[],
  view: string,
  filters: ConnectionFilters,
  selected: string | null
): { nodes: Node[]; edges: Edge[] } {
  const nodes = [
    ...new Map(
      inputNodes
        .filter((node) => node.type !== "group")
        .map((node) => [node.id, node])
    ).values(),
  ];
  const edges = inputEdges.filter((edge) => filters[getConnectionKind(edge)]);
  if (selected || (view !== "overview" && view !== "all")) {
    const members = new Set(
      selected
        ? [selected]
        : nodes
            .filter((node) => getSubsystem(node) === view)
            .map((node) => node.id)
    );
    const ids = new Set(members);
    for (const edge of edges) {
      if (members.has(edge.source) || members.has(edge.target)) {
        ids.add(edge.source);
        ids.add(edge.target);
      }
    }
    return {
      nodes: nodes.filter((node) => ids.has(node.id)),
      edges: edges
        .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
        .map((edge) =>
          selected ? { ...edge, style: { ...edge.style, opacity: 1 } } : edge
        ),
    };
  }
  if (view === "all") return { nodes, edges };

  const groups = new Map<string, Node[]>();
  const endpoints = new Map<string, string>();
  const visible = nodes.filter((node) => {
    const group = getSubsystem(node);
    endpoints.set(node.id, group ? `subsystem-${group}` : node.id);
    if (!group) return true;
    const members = groups.get(group) ?? [];
    members.push(node);
    groups.set(group, members);
    return false;
  });
  for (const definition of SUBSYSTEMS) {
    const members = groups.get(definition.id);
    if (!members?.length) continue;
    const internalLinks = edges.filter(
      (edge) =>
        endpoints.get(edge.source) === `subsystem-${definition.id}` &&
        endpoints.get(edge.target) === `subsystem-${definition.id}`
    ).length;
    visible.push({
      id: `subsystem-${definition.id}`,
      type: "subsystem",
      position: { x: 0, y: 0 },
      data: {
        name: definition.name,
        label: definition.name,
        subsystemId: definition.id,
        memberCount: members.length,
        memberType: definition.id === "roles" ? "roles" : "contracts",
        internalLinks,
      },
      style: { width: getContractNodeWidth({ name: definition.name }) },
    });
  }
  const summaries = new Map<string, Edge>();
  for (const edge of edges) {
    const source = endpoints.get(edge.source);
    const target = endpoints.get(edge.target);
    if (!source || !target || source === target) continue;
    const kind = getConnectionKind(edge);
    const pending = Boolean(edge.data?.pending);
    const id = `summary:${source}:${target}:${kind}:${pending}`;
    const summary = summaries.get(id);
    if (summary) {
      if (!summary.data.members.some((member: Edge) => member.id === edge.id))
        summary.data.members.push(edge);
    } else
      summaries.set(id, {
        ...edge,
        id,
        source,
        target,
        sourceHandle: `${source}-source`,
        targetHandle: `${target}-target`,
        data: { kind, pending, members: [edge] },
      });
  }
  const pairs = new Map<string, Edge[]>();
  for (const edge of summaries.values()) {
    const pair = `${edge.source}:${edge.target}`;
    const group = pairs.get(pair) ?? [];
    group.push(edge);
    pairs.set(pair, group);
  }
  return {
    nodes: visible,
    edges: [...pairs.values()].flatMap((group) =>
      group.map((edge, index) => ({
        ...edge,
        labelStyle: {
          ...edge.labelStyle,
          transform: `translateY(${(index - (group.length - 1) / 2) * 18 - 12}px)`,
        },
        labelBgStyle: {
          ...edge.labelBgStyle,
          transform: `translateY(${(index - (group.length - 1) / 2) * 18 - 12}px)`,
        },
        label: `${edge.data.members.length} ${edge.data.pending ? "pending " : ""}${edge.data.kind === "permission" ? "permissions" : edge.data.kind === "reference" ? "references" : "control links"}`,
      }))
    ),
  };
}
