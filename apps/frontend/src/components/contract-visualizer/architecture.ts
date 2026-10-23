import type { Edge, Node } from "reactflow";
import dagre from "dagre";
import { getGraphNodeWidth } from "./graph";

export const SUBSYSTEMS = [
  { id: "core", name: "Kernel & modules" },
  { id: "cooler", name: "Cooler & lending" },
  { id: "bridging", name: "Cross-chain bridges" },
  { id: "ccip", name: "CCIP" },
  { id: "deposits", name: "Deposits & reserves" },
  { id: "reserve-tokens", name: "Reserve tokens" },
  { id: "monetary", name: "Monetary policy" },
  { id: "governance", name: "Governance & configuration" },
  { id: "tokens", name: "Olympus Tokens" },
  { id: "proposals", name: "Proposal helpers" },
  { id: "bond-protocol", name: "Bond Protocol" },
  { id: "roles", name: "Roles" },
  { id: "other", name: "Other contracts" },
  { id: "inactive", name: "Removed from Kernel" },
];
export type ConnectionKind = "permission" | "control" | "reference";
export type ConnectionFilters = Record<ConnectionKind, boolean>;

export function layoutContractGraph(nodes: Node[], edges: Edge[]) {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: "LR",
    nodesep: 80,
    ranksep: 150,
    edgesep: 32,
    marginx: 100,
    marginy: 100,
  });
  for (const node of nodes)
    graph.setNode(node.id, {
      width: getGraphNodeWidth(node),
      height: node.height ?? (node.type === "role" ? 80 : 120),
    });
  for (const edge of edges)
    graph.setEdge(
      edge.source,
      edge.target,
      {
        width: Math.min(280, (edge.data?.labelText?.length ?? 0) * 7),
        height: edge.data?.labelText ? 24 : 0,
        labelpos: "c",
      },
      edge.id
    );
  dagre.layout(graph);
  const positioned = nodes.map((node) => {
    const position = graph.node(node.id);
    return {
      ...node,
      position: {
        x: position.x - position.width / 2,
        y: position.y - position.height / 2,
      },
    };
  });
  const positions = new Map(positioned.map((node) => [node.id, node.position]));
  return {
    nodes: positioned,
    edges: edges.map((edge) => {
      const route = graph.edge(edge.source, edge.target, edge.id);
      return {
        ...edge,
        data: {
          ...edge.data,
          route: {
            points: route.points,
            labelX: route.x,
            labelY: route.y,
            sourcePosition: positions.get(edge.source),
            targetPosition: positions.get(edge.target),
          },
        },
      };
    }),
  };
}

export function getSubsystem(node: Node): string | null {
  if (node.data.kernelInactive) return "inactive";
  if (node.id.startsWith("role-")) return "roles";
  if (/\bMS\b|Multisig/.test(node.data.name)) return null;
  if (["kernel", "module"].includes(node.data.contractType)) return "core";
  const name = (node.data.name as string).replace(/ \([^)]*\)$/, "");
  if (/Proposal(?:Helper|Checker)$|^ConvertibleDepositActivator$/.test(name))
    return "proposals";
  if (/^BondFixedTermSDA$/.test(name)) return "bond-protocol";
  if (
    /^(?:(?:Mock )?(?:USDS|sUSDS|DAI|sDAI)|DaiUsdsMigrator|MockDaiUsds)$/.test(
      name
    )
  )
    return "reserve-tokens";
  if (
    /CCIPTokenPoolConfig|TreasuryCustodian|RolesAdmin|PriceConfig|RegistryAdmin|Authority|Emergency|Governor/.test(
      name
    )
  )
    return "governance";
  if (/Cooler|Clearinghouse|BLVault/.test(name)) return "cooler";
  if (/CrossChainBridge|LayerZero|^LZ/.test(name)) return "bridging";
  if (
    /CCIP|TokenAdminRegistry|LockReleaseTokenPool|BurnMintTokenPool/.test(name)
  )
    return "ccip";
  if (/Deposit|Reserve/.test(name)) return "deposits";
  if (
    /Bond|Emission|Heart|Operator|Distributor|YieldRepurchase|pOLY/.test(name)
  )
    return "monetary";
  if (/^(OHM|sOHM|gOHM|Staking|Minter|V1Migrator)$/.test(name)) return "tokens";
  return node.data.assigneeAddress ? null : "other";
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
  const edges = [
    ...new Map(
      inputEdges
        .filter((edge) => filters[getConnectionKind(edge)])
        .map((edge) => [edge.id, edge])
    ).values(),
  ];
  if (selected || (view !== "overview" && view !== "all")) {
    const members = new Set(
      selected
        ? [selected]
        : nodes
            .filter((node) => getSubsystem(node) === view)
            .map((node) => node.id)
    );
    const ids = new Set(members);
    const periodicTasks = edges.filter(
      (edge) =>
        members.has(edge.source) &&
        edge.data?.relationship?.kind === "periodic-task"
    );
    const matchesTaskInvocation = (edge: Edge) =>
      periodicTasks.some(
        (task) =>
          task.target === edge.source &&
          task.data?.relationship?.callSelector ===
            edge.data?.relationship?.callSelector
      );
    for (const edge of edges) {
      const relationship = edge.data?.relationship;
      const scopedMember =
        relationship?.kind === "token-admin" &&
        [relationship.scope?.registry, relationship.scope?.token].some(
          (address) => address && members.has(address.toLowerCase())
        );
      if (
        members.has(edge.source) ||
        members.has(edge.target) ||
        (edge.data?.relationship?.kind === "task-call" &&
          matchesTaskInvocation(edge)) ||
        scopedMember
      ) {
        ids.add(edge.source);
        ids.add(edge.target);
        if (relationship?.kind === "token-admin") {
          for (const address of [
            relationship.source,
            relationship.scope?.registry,
            relationship.scope?.token,
          ]) {
            if (address) ids.add(address.toLowerCase());
          }
        }
      }
    }
    return {
      nodes: nodes.filter((node) => ids.has(node.id)),
      edges: edges
        .filter(
          (edge) =>
            ids.has(edge.source) &&
            ids.has(edge.target) &&
            (edge.data?.relationship?.kind !== "task-call" ||
              !periodicTasks.some((task) => task.target === edge.source) ||
              matchesTaskInvocation(edge))
        )
        .map((edge) =>
          selected ? { ...edge, style: { ...edge.style, opacity: 1 } } : edge
        ),
    };
  }
  return { nodes, edges };
}

export function layoutArchitectureSections(nodes: Node[]): Node[] {
  const definitions = [
    { id: "shared", name: "Shared controllers & registries" },
    ...SUBSYSTEMS,
  ];
  const sections = definitions
    .map((definition) => {
      const members = nodes.filter(
        (node) => (getSubsystem(node) ?? "shared") === definition.id
      );
      const columns = Math.min(
        definition.id === "shared" ? 6 : 3,
        members.length
      );
      const cellWidth = Math.max(180, ...members.map(getGraphNodeWidth)) + 40;
      return {
        ...definition,
        members,
        columns,
        cellWidth,
        width: columns * cellWidth + 40,
        height: Math.ceil(members.length / (columns || 1)) * 150 + 80,
      };
    })
    .filter((section) => section.members.length);
  const backgrounds: Node[] = [];
  const cards: Node[] = [];
  const main = sections.filter(
    (section) => !["inactive", "roles", "shared"].includes(section.id)
  );
  const columns = Math.min(3, main.length);
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(
      ...main
        .filter((_, index) => index % columns === column)
        .map((section) => section.width)
    )
  );
  let rowY = 0;
  const place = (section: (typeof sections)[number], x: number, y: number) => {
    backgrounds.push({
      id: `section-${section.id}`,
      type: "group",
      position: { x, y },
      data: { name: section.name, label: section.name, sectionId: section.id },
      selectable: false,
      focusable: false,
      draggable: false,
      connectable: false,
      zIndex: -1,
      style: {
        width: section.width,
        height: section.height,
        padding: "16px 24px",
        fontSize: 20,
        fontWeight: 600,
        color: "#64748b",
        background: "rgba(241,245,249,0.5)",
        border: "1px solid #cbd5e1",
        pointerEvents: "none",
      },
    });
    section.members.forEach((node, index) => {
      cards.push({
        ...node,
        position: {
          x: x + 20 + (index % section.columns) * section.cellWidth,
          y: y + 60 + Math.floor(index / section.columns) * 150,
        },
      });
    });
  };
  const shared = sections.find((section) => section.id === "shared");
  if (shared) {
    place(shared, 0, 0);
    rowY = shared.height + 100;
  }
  for (let row = 0; row < Math.ceil(main.length / (columns || 1)); row++) {
    let x = 0;
    for (let column = 0; column < columns; column++) {
      const section = main[row * columns + column];
      if (section) place(section, x, rowY);
      x += (widths[column] ?? 0) + 100;
    }
    rowY +=
      Math.max(
        ...main
          .slice(row * columns, (row + 1) * columns)
          .map((section) => section.height)
      ) + 100;
  }
  let sideY = 0;
  const sideX =
    Math.max(
      widths.reduce((sum, width) => sum + width + 100, 0),
      shared?.width ?? 0
    ) + 100;
  for (const section of sections.filter((section) =>
    ["roles", "inactive"].includes(section.id)
  )) {
    place(section, sideX, sideY);
    sideY += section.height + 100;
  }
  return [...backgrounds, ...cards];
}
