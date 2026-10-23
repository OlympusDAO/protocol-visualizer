import { useCallback, useEffect, useState, useRef } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  useEdgesState,
  useNodesState,
  type NodeTypes,
  type Edge,
  Position,
  Handle,
  MarkerType,
  type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import {
  type Contract,
  getProtocolVisualizerData,
  getAdditionalGraphContracts,
  type RoleAssignment,
  type PolicyFunction,
  type PolicyPermission,
} from "@/services/contracts";
import { ConnectionLabel, FunctionDocumentation } from "./function-context";
import { ChainSelector } from "../chain-selector";
import { SUPPORTED_CHAINS } from "@/lib/constants";
import { useGraphNavigation } from "./navigation";
import {
  getArchitectureView,
  layoutArchitectureSections,
  layoutContractGraph,
  getSubsystem,
  SUBSYSTEMS,
  type ConnectionFilters,
  type ConnectionKind,
} from "./architecture";
import { RelationshipEdge } from "./relationship-edge";
import otherContracts from "../../../../../packages/protocol-config/other-contracts.json";
import {
  getFunctionTooltip,
  getEnablementPresentation,
  getRelationshipGraph,
  getRelationshipPath,
  getContractPalette,
  getContractDeploymentLabel,
  getGraphContractName,
  getContractNodeWidth,
  getKernelLabel,
  refreshGraph,
  groupInactiveContracts,
} from "./graph";

interface NodeData {
  name: string;
  contractType?: string;
  kernelInactive?: boolean;
  label: React.ReactNode;
  assignees?: RoleAssignment[];
  policiesCount?: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  assigneeAddress?: string;
  modulesUsedCount?: number;
}

type CustomNode = Node<NodeData>;

function StatusTooltip({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
      className={`nodrag nopan group/status relative inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${className}`}
    >
      {children}
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-normal text-slate-800 shadow-md group-hover/status:visible group-focus/status:visible"
      >
        {label}
      </span>
    </button>
  );
}

function EnablementIndicator({ label }: { label: string }) {
  return (
    <StatusTooltip
      label={label}
      className={`inline-flex align-middle ${label === "Contract enabled" ? "text-emerald-700" : "text-rose-700"}`}
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path
          d={label === "Contract enabled" ? "m8 12 3 3 5-6" : "m6 6 12 12"}
        />
      </svg>
    </StatusTooltip>
  );
}

function ContractStatusIcons({
  contract,
  enablementLabel,
}: {
  contract: { isEnabled?: boolean; category?: string };
  enablementLabel: string | null;
}) {
  const membership = getKernelLabel(contract);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {membership && (
        <StatusTooltip
          label={
            membership === "Kernel active"
              ? "Active in Kernel"
              : "Inactive in Kernel"
          }
          className={
            membership === "Kernel active"
              ? "inline-flex text-blue-700"
              : "inline-flex text-slate-500"
          }
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="6" y="6" width="15" height="15" rx="2" />
            <path d="M17 3H5a2 2 0 0 0-2 2v12" />
            {membership === "Kernel inactive" && <path d="m3 3 18 18" />}
          </svg>
        </StatusTooltip>
      )}
      {enablementLabel && <EnablementIndicator label={enablementLabel} />}
    </span>
  );
}

// Helper functions
const shortenAddress = (address: string) => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const getEtherscanLink = (address: string, chainId: number) => {
  const chain = SUPPORTED_CHAINS.find(
    (candidate) => candidate.chainId === chainId
  );
  if (!chain) {
    throw new Error(`Unsupported chain id for explorer link: ${chainId}`);
  }
  return `${chain.explorerBaseUrl}/address/${address}`;
};

// Helper function to format contract name with version
const formatContractName = (contract: Contract) => {
  if (!contract.name) return "Unknown";
  return getGraphContractName(contract);
};

// Extract keycode from module name (e.g., "MINTR" from "MINTR: Minter")
const extractKeycode = (moduleName: string): string | null => {
  const match = moduleName.match(/^[A-Z0-9]{1,5}/);
  return match ? match[0] : null;
};

// Node color scheme
const NODE_COLORS = {
  periphery: {
    background: "#e0e7ff",
    border: "#6366f1",
    text: "#3730a3",
  },
  external: {
    background: "#f9fafb",
    border: "#9ca3af",
    text: "#374151",
  },
  kernel: {
    background: "#fef3c7", // Amber 100
    border: "#d97706", // Amber 600
    text: "#92400e", // Amber 800
  },
  module: {
    background: "#dbeafe", // Blue 100
    border: "#2563eb", // Blue 600
    text: "#1e40af", // Blue 800
  },
  policy: {
    background: "#dcfce7", // Green 100
    border: "#16a34a", // Green 600
    text: "#166534", // Green 800
  },
  role: {
    background: "#f3e8ff", // Purple 100
    border: "#9333ea", // Purple 600
    text: "#6b21a8", // Purple 800
  },
  assignee: {
    background: "#fae8ff", // Pink 100
    border: "#db2777", // Pink 600
    text: "#9d174d", // Pink 800
  },
};

const createAddressNode = (
  assignee: Pick<RoleAssignment, "assignee" | "assigneeName">,
  id: string,
  chainId: number,
  contract = false
) => {
  const knownContract =
    contract ||
    otherContracts.some(
      (entry) =>
        entry.chainId === chainId &&
        entry.address === id &&
        !/\bMS\b|Multisig|^Deployer$/.test(entry.name)
    );
  const assigneeName =
    assignee.assigneeName === "UNKNOWN"
      ? knownContract
        ? "Unknown contract"
        : "Unknown address"
      : assignee.assigneeName;
  const colors = knownContract
    ? NODE_COLORS[getContractPalette({ name: assigneeName })]
    : NODE_COLORS.assignee;

  return {
    id,
    data: {
      name: assigneeName,
      label: (
        <div className="p-1 text-sm relative">
          <Handle
            id={`${id}-target`}
            type="target"
            position={Position.Left}
            style={{
              background: colors.border,
              border: `1px solid ${colors.border}`,
            }}
          />
          <div
            className="font-bold mb-1 wrap-break-word"
            style={{ color: colors.text }}
          >
            {assigneeName}
          </div>
          <a
            href={getEtherscanLink(assignee.assignee, chainId)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs break-all hover:opacity-80"
            style={{ color: colors.border }}
          >
            {shortenAddress(assignee.assignee)}
          </a>
          <Handle
            id={`${id}-source`}
            type="source"
            position={Position.Right}
            style={{
              background: colors.border,
              border: `1px solid ${colors.border}`,
            }}
          />
        </div>
      ),
      ...(knownContract ? {} : { assigneeAddress: assignee.assignee }),
    },
    style: {
      background: colors.background,
      border: `1px solid ${colors.border}`,
      borderRadius: "8px",
      padding: "6px",
      width: getContractNodeWidth({ name: assigneeName }),
    },
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
  };
};

// Node types configuration
const edgeTypes = { relationship: RelationshipEdge };

const nodeTypes: NodeTypes = {
  group: ({ data }) => <div>{data.label}</div>,
  role: ({ data }: { data: NodeData }) => (
    // biome-ignore lint/a11y/noStaticElementInteractions: graph node hover state is handled by React Flow, not an interactive control.
    <div
      className="rounded-lg p-4 cursor-pointer transition-colors"
      style={{
        background: NODE_COLORS.role.background,
        border: `1px solid ${NODE_COLORS.role.border}`,
      }}
      onMouseEnter={() => data.onMouseEnter?.()}
      onMouseLeave={() => data.onMouseLeave?.()}
    >
      <Handle
        id="role-target"
        type="target"
        position={Position.Left}
        style={{
          background: NODE_COLORS.role.border,
          border: `1px solid ${NODE_COLORS.role.border}`,
        }}
      />
      <div className="font-bold mb-2" style={{ color: NODE_COLORS.role.text }}>
        {data.label}
      </div>
      <div className="flex flex-col gap-1">
        {data.assignees && (
          <div className="text-xs" style={{ color: NODE_COLORS.role.border }}>
            {data.assignees.length} Active Assignee(s)
          </div>
        )}
        {data.policiesCount !== undefined && (
          <div className="text-xs" style={{ color: NODE_COLORS.policy.border }}>
            {data.policiesCount} Policy Usage(s)
          </div>
        )}
      </div>
      <Handle
        id="role-source"
        type="source"
        position={Position.Right}
        style={{
          background: NODE_COLORS.role.border,
          border: `1px solid ${NODE_COLORS.role.border}`,
        }}
      />
    </div>
  ),
};

// Custom tooltip components

// Custom tooltip component
const PolicyTooltip = ({ contract }: { contract: Contract }) => {
  if (!contract.policyPermissions) return null;

  return (
    <div
      className="fixed ml-2 bg-white shadow-lg rounded-lg p-4 min-w-[300px] border border-gray-200"
      style={{
        zIndex: 9999,
        left: "calc(100% + 8px)",
        top: "50%",
        transform: "translateY(-50%)",
      }}
    >
      <h3 className="font-bold text-sm mb-2">{formatContractName(contract)}</h3>
      <div className="text-xs text-gray-600 mb-3">
        Last Updated:{" "}
        {new Date(
          Number(contract.lastUpdatedTimestamp) * 1000
        ).toLocaleString()}
      </div>
      <div className="text-sm">
        <div className="font-semibold mb-1">Modules Used:</div>
        <ul className="list-disc pl-4">
          {Array.from(
            new Set(
              (contract.policyPermissions as Array<{ keycode: string }>).map(
                (p) => p.keycode
              )
            )
          ).map((keycode) => (
            <li key={keycode} className="text-xs mb-1">
              <span className="text-blue-600">{keycode}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export function ContractVisualizer() {
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [hoveredPolicy, setHoveredPolicy] = useState<string | null>(null);
  const [hoveredRole, setHoveredRole] = useState<string | null>(null);
  const {
    node: selectedNode,
    chainId: selectedChainId,
    notice: navigationNotice,
    setSelectedNode,
    setSelectedChainId,
    reconcileSelection,
  } = useGraphNavigation();
  const [layouting, setLayouting] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [architectureView, setArchitectureView] = useState("overview");
  const [connectionFilters, setConnectionFilters] = useState<ConnectionFilters>(
    {
      permission: false,
      control: true,
      reference: true,
    }
  );
  const [canonicalGraph, setCanonicalGraph] = useState<{
    chainId: number;
    nodes: CustomNode[];
    edges: Edge[];
  } | null>(null);

  // Add ref for ReactFlow instance
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const previousView = useRef<{
    key: string;
    instance: ReactFlowInstance | null;
    fitted: boolean;
  } | null>(null);

  // Reset initialized state when chain ID changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedChainId intentionally triggers a graph reset.
  useEffect(() => {
    setInitialized(false);
    setNodes([]);
    setEdges([]);
    setCanonicalGraph(null);
    setArchitectureView("overview");
    previousView.current = null;
  }, [selectedChainId, setNodes, setEdges]);

  const isHistorical =
    SUPPORTED_CHAINS.find((chain) => chain.chainId === selectedChainId)
      ?.availability === "historical";
  const { data, isLoading, error } = useQuery({
    queryKey: ["protocol-visualizer", selectedChainId],
    queryFn: () => getProtocolVisualizerData(selectedChainId),
    enabled: !isHistorical,
    refetchInterval: 60_000,
  });

  const contracts = data?.contracts;
  const roles = data?.roles;
  const roleAssignments = data?.roleAssignments;
  const hasNoContractData =
    !isLoading &&
    !error &&
    (contracts?.length ?? 0) +
      (data?.additionalContracts.length ?? 0) +
      (data?.relationships.length ?? 0) ===
      0;

  useEffect(() => {
    if (!isHistorical || !selectedNode) return;
    const recorded = otherContracts.some(
      (contract) =>
        contract.chainId === selectedChainId &&
        contract.address === selectedNode
    );
    if (!recorded) reconcileSelection(null);
    else
      document
        .getElementById(`inventory-${selectedNode}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [isHistorical, selectedNode, selectedChainId, reconcileSelection]);

  useEffect(() => {
    if (!data) return;
    setInitialized(false);
  }, [data]);

  const createNodeFromContract = useCallback(
    (contract: Contract, id: string) => {
      const type = contract.type;
      const control = getEnablementPresentation(
        data?.contractStates.find(
          (state) => state.address.toLowerCase() === contract.address
        ),
        data?.observation
      );
      const colors =
        type === "kernel"
          ? NODE_COLORS.kernel
          : type === "module"
            ? NODE_COLORS.module
            : NODE_COLORS.policy;

      // Calculate modules used count for policies
      let modulesUsedCount = 0;
      if (
        type === "policy" &&
        contract.policyPermissions &&
        Array.isArray(contract.policyPermissions)
      ) {
        // Get unique keycodes from policy permissions
        const uniqueKeycodes = new Set(
          (contract.policyPermissions as Array<{ keycode: string }>).map(
            (p) => p.keycode
          )
        );
        modulesUsedCount = uniqueKeycodes.size;
      }

      return {
        id,
        data: {
          name: formatContractName(contract),
          contractType: type,
          kernelInactive: contract.isEnabled === false,
          label: (
            // biome-ignore lint/a11y/noStaticElementInteractions: graph node hover state is handled by React Flow, not an interactive control.
            <div
              className="p-1 text-sm relative"
              style={{ position: "relative" }}
              onMouseEnter={() =>
                type === "policy" && setHoveredPolicy(contract.address)
              }
              onMouseLeave={() => type === "policy" && setHoveredPolicy(null)}
            >
              <Handle
                id={`${id}-target`}
                type="target"
                position={Position.Left}
                style={{
                  background: colors.border,
                  border: `1px solid ${colors.border}`,
                }}
              />
              <div className="flex justify-end mb-1">
                <ContractStatusIcons
                  contract={contract}
                  enablementLabel={control.badge}
                />
              </div>
              <div
                className="font-bold wrap-break-word mb-1"
                style={{ color: colors.text }}
              >
                {formatContractName(contract)}
              </div>
              <a
                href={getEtherscanLink(contract.address, selectedChainId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs break-all hover:opacity-80"
                style={{ color: colors.border }}
              >
                {shortenAddress(contract.address)}
              </a>
              {control.warning && (
                <div className="text-xs mt-1 text-amber-800 max-w-[180px]">
                  {control.warning}
                </div>
              )}
              {type === "policy" && modulesUsedCount > 0 && (
                <div
                  className="text-xs mt-1"
                  style={{ color: NODE_COLORS.module.border }}
                >
                  {modulesUsedCount} Module{modulesUsedCount !== 1 ? "s" : ""}{" "}
                  Used
                </div>
              )}
              {type === "policy" && hoveredPolicy === contract.address && (
                <PolicyTooltip contract={contract} />
              )}
              <Handle
                id={`${id}-source`}
                type="source"
                position={Position.Right}
                style={{
                  background: colors.border,
                  border: `1px solid ${colors.border}`,
                }}
              />
            </div>
          ),
          modulesUsedCount,
        },
        style: {
          background: colors.background,
          border: `1px solid ${colors.border}`,
          borderRadius: "8px",
          padding: "6px",
          opacity: contract.isEnabled ? 1 : 0.7,
          width: getContractNodeWidth(contract),
          zIndex: hoveredPolicy === contract.address ? 1000 : 1,
        },
        targetPosition: Position.Left,
        sourcePosition: Position.Right,
      };
    },
    [hoveredPolicy, selectedChainId, data]
  );

  // Memoize the edge creation function
  const createEdge = useCallback(
    (source: string, target: string, animated: boolean = false) => {
      const sourceIsRole = source.startsWith("role-");
      const targetIsRole = target.startsWith("role-");
      const targetIsPolicy =
        target.startsWith("0x") && !source.startsWith("0x");

      // Use green for role -> policy edges, purple for others
      const edgeColor = targetIsPolicy
        ? NODE_COLORS.policy.border
        : NODE_COLORS.role.border;

      return {
        id: `${source}-${target}`,
        source,
        target,
        sourceHandle: sourceIsRole ? "role-source" : `${source}-source`,
        targetHandle: targetIsRole ? "role-target" : `${target}-target`,
        type: "smoothstep",
        data: { kind: "permission" },
        style: {
          stroke: edgeColor,
          strokeWidth: 2,
          opacity: 0.65,
          transition: "opacity 0.2s",
        },
        animated,
        markerEnd: {
          type: MarkerType.Arrow,
          color: edgeColor,
          width: 20,
          height: 20,
        },
      };
    },
    []
  );

  const setupGraph = useCallback(() => {
    if (!contracts || !roles || !roleAssignments || layouting) return;

    setLayouting(true);
    const newNodes: CustomNode[] = [];
    const newEdges: Edge[] = [];

    // Group contracts by type
    const kernelContract = contracts.find((c) => c.type === "kernel") as
      | Contract
      | undefined;
    const moduleContracts = contracts.filter(
      (c) => c.type === "module"
    ) as Contract[];
    const policyContracts = contracts.filter(
      (c) => c.type === "policy"
    ) as Contract[];

    // Create a mapping of module keycodes to module addresses
    const moduleKeycodeToAddress = new Map<string, string>();
    moduleContracts.forEach((module) => {
      const keycode = extractKeycode(module.name);
      if (keycode) {
        moduleKeycodeToAddress.set(keycode, module.address);
      }
    });

    // Add kernel node
    if (kernelContract) {
      newNodes.push({
        ...createNodeFromContract(kernelContract, kernelContract.address),
        position: { x: 0, y: 0 },
      });
    }

    // Add module nodes
    moduleContracts.forEach((contract) => {
      newNodes.push({
        ...createNodeFromContract(contract, contract.address),
        position: { x: 0, y: 0 },
      });
    });

    // Add policy nodes and connect to modules
    policyContracts.forEach((policy) => {
      newNodes.push({
        ...createNodeFromContract(policy, policy.address),
        position: { x: 0, y: 0 },
      });

      // Connect policy to modules it uses
      if (policy.policyPermissions && Array.isArray(policy.policyPermissions)) {
        const uniqueKeycodes = Array.from(
          new Set(
            (policy.policyPermissions as Array<{ keycode: string }>).map(
              (p) => p.keycode
            )
          )
        );

        uniqueKeycodes.forEach((keycode) => {
          const moduleAddress = moduleKeycodeToAddress.get(keycode);
          if (moduleAddress) {
            newEdges.push(createEdge(policy.address, moduleAddress, false));
          }
        });
      }
    });

    const additional = data ? getAdditionalGraphContracts(data) : [];
    for (const contract of additional) {
      const state = data?.contractStates.find(
        (state) => state.address.toLowerCase() === contract.address
      );
      const control = getEnablementPresentation(state, data?.observation);
      const colors = NODE_COLORS[getContractPalette(contract)];
      newNodes.push({
        id: contract.address,
        position: { x: 0, y: 0 },
        data: {
          name: getGraphContractName(contract),
          contractType: contract.contractType?.toLowerCase(),
          kernelInactive: contract.category === "inactive-core",
          label: (
            <div className="p-2 text-sm">
              <Handle
                id={`${contract.address}-target`}
                type="target"
                position={Position.Left}
              />
              <div className="flex justify-end mb-1">
                <ContractStatusIcons
                  contract={contract}
                  enablementLabel={control.badge}
                />
              </div>
              <div
                className="font-semibold wrap-break-word mb-1"
                style={{ color: colors.text }}
              >
                {getGraphContractName(contract)}
              </div>
              <a
                href={getEtherscanLink(contract.address, selectedChainId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600"
              >
                {shortenAddress(contract.address)}
              </a>
              {contract.category === "external" && (
                <div className="mt-1 text-xs text-gray-500">
                  {getContractDeploymentLabel(contract)}
                </div>
              )}
              {control.warning && (
                <div className="text-xs mt-1 text-amber-800 max-w-[180px]">
                  {control.warning}
                </div>
              )}
              <Handle
                id={`${contract.address}-source`}
                type="source"
                position={Position.Right}
              />
            </div>
          ),
        },
        style: {
          background: colors.background,
          border: `1px solid ${colors.border}`,
          borderRadius: "8px",
          width: getContractNodeWidth(contract),
        },
      });
    }

    // Process roles and assignees
    roles.forEach((role) => {
      const roleId = `role-${role.role}`;
      const roleAssignmentsList = roleAssignments.filter(
        (a) => a.role === role.role
      );

      // Find policies that use this role
      const policiesUsingRole = contracts.filter(
        (c) =>
          c.type === "policy" &&
          Array.isArray(c.policyFunctions) &&
          (c.policyFunctions as Array<{ roles: string[]; name: string }>).some(
            (func) => func.roles.includes(role.role)
          )
      );

      // Add role node
      newNodes.push({
        id: roleId,
        type: "role",
        position: { x: 0, y: 0 },
        data: {
          name: role.role,
          label: role.role,
          assignees: roleAssignmentsList,
          policiesCount: policiesUsingRole.length,
          onMouseEnter: () => setHoveredRole(role.role),
          onMouseLeave: () => setHoveredRole(null),
        },
        style: {
          zIndex: hoveredRole === role.role ? 1000 : 1,
        },
        targetPosition: Position.Left,
        sourcePosition: Position.Right,
      });

      // Process assignees
      roleAssignmentsList.forEach((assignment) => {
        const isAssignee = (contract: { address: string }) =>
          contract.address.toLowerCase() === assignment.assignee.toLowerCase();
        const contractNode =
          contracts.find(isAssignee) ?? additional.find(isAssignee);

        if (contractNode) {
          // Add edge to existing contract node
          newEdges.push(createEdge(assignment.assignee, roleId, false));
        } else {
          // Create node for non-contract assignee
          const assigneeId = assignment.assignee.toLowerCase();
          newNodes.push({
            ...createAddressNode(assignment, assigneeId, selectedChainId),
            position: { x: 0, y: 0 },
          });

          // Add edge from role to assignee
          newEdges.push(createEdge(assigneeId, roleId, false));
        }
      });

      // Link roles with policies that use them
      const policyContracts = contracts.filter(
        (c) => c.type === "policy" && Array.isArray(c.policyFunctions)
      );
      policyContracts.forEach((policy) => {
        const policyFunctions = policy.policyFunctions as PolicyFunction[];
        const hasRole = policyFunctions.some((func) =>
          func.roles.includes(role.role)
        );
        if (hasRole) {
          newEdges.push(createEdge(roleId, policy.address, false));
        }
      });
    });

    const relationships = getRelationshipGraph(
      data?.relationships ?? [],
      selectedChainId,
      data?.periodicTasks ?? []
    );
    const nodeIds = new Set(newNodes.map((node) => node.id));
    for (const address of relationships.addresses) {
      if (nodeIds.has(address)) continue;
      const assigneeName =
        roleAssignments.find(
          (assignment) => assignment.assignee.toLowerCase() === address
        )?.assigneeName ??
        otherContracts.find(
          (contract) =>
            contract.chainId === selectedChainId && contract.address === address
        )?.name ??
        "UNKNOWN";
      newNodes.push({
        ...createAddressNode(
          { assignee: address, assigneeName },
          address,
          selectedChainId,
          !roleAssignments.some(
            (assignment) => assignment.assignee.toLowerCase() === address
          ) &&
            !data?.relationships.some(
              (relationship) =>
                relationship.status === "current" &&
                relationship.source.toLowerCase() === address
            ) &&
            (data?.relationships.some(
              (relationship) =>
                relationship.status === "reference" &&
                relationship.target?.toLowerCase() === address &&
                relationship.targetCode === "present"
            ) ??
              false)
        ),
        position: { x: 0, y: 0 },
      });
      nodeIds.add(address);
    }
    for (const edge of relationships.edges) {
      const periodicTask = edge.relationship.kind === "periodic-task";
      const color = periodicTask ? "#0f766e" : "#475569";
      newEdges.push({
        ...createEdge(edge.source, edge.target),
        id: edge.id,
        type: "relationship",
        label: (
          <ConnectionLabel
            label={edge.label}
            functions={
              edge.relationship.callSignature
                ? [{ signature: edge.relationship.callSignature }]
                : edge.relationship.functionContext
                  ? [edge.relationship.functionContext]
                  : [{ signature: edge.label }]
            }
          />
        ),
        ariaLabel:
          edge.relationship.callSignature ??
          (edge.relationship.functionContext
            ? getFunctionTooltip([edge.relationship.functionContext])
            : edge.label),
        data: {
          kind:
            edge.relationship.status === "reference" ? "reference" : "control",
          pending: edge.pending,
          relationship: edge.relationship,
          labelText: edge.label,
          laneOffset: edge.labelOffset * 2.5,
        },
        style: {
          stroke: color,
          strokeWidth: periodicTask ? 2.5 : 2,
          opacity: periodicTask ? 1 : 0.7,
          ...(edge.pending ? { strokeDasharray: "6 4" } : {}),
        },
        labelStyle: {
          fontSize: 11,
          fill: "#334155",
        },
        markerEnd: { type: MarkerType.Arrow, color },
      });
    }

    const canonical = refreshGraph(newNodes, [], selectedNode);
    setCanonicalGraph({
      chainId: selectedChainId,
      nodes: canonical.nodes,
      edges: newEdges,
    });
    reconcileSelection(canonical.selectedNode);
    setLayouting(false);
    setInitialized(true);
  }, [
    data,
    contracts,
    roles,
    roleAssignments,
    layouting,
    createNodeFromContract,
    createEdge,
    hoveredRole,
    selectedChainId,
    selectedNode,
    reconcileSelection,
  ]);

  useEffect(() => {
    if (!canonicalGraph || canonicalGraph.chainId !== selectedChainId) return;
    const projected = getArchitectureView(
      canonicalGraph.nodes,
      canonicalGraph.edges,
      architectureView,
      connectionFilters,
      selectedNode
    );
    const viewNodes = projected.nodes;
    const sectioned = architectureView === "overview" && !selectedNode;
    let finalNodes: Node[];
    let layoutEdges = projected.edges;
    if (sectioned) finalNodes = layoutArchitectureSections(viewNodes);
    else {
      const inactive =
        architectureView === "all" && !selectedNode
          ? viewNodes.filter((node) => node.data.kernelInactive)
          : [];
      const inactiveIds = new Set(inactive.map((node) => node.id));
      const active = viewNodes.filter((node) => !inactiveIds.has(node.id));
      const activeIds = new Set(active.map((node) => node.id));
      const layout = layoutContractGraph(
        active,
        projected.edges.filter(
          (edge) => activeIds.has(edge.source) && activeIds.has(edge.target)
        )
      );
      finalNodes = groupInactiveContracts(layout.nodes, inactive);
      const routed = new Map(layout.edges.map((edge) => [edge.id, edge]));
      layoutEdges = projected.edges.map((edge) => routed.get(edge.id) ?? edge);
    }
    const key = JSON.stringify([
      selectedChainId,
      architectureView,
      selectedNode,
      finalNodes.map((node) => [
        node.id,
        node.style?.width,
        node.style?.height,
      ]),
      projected.edges.map((edge) => [edge.id, edge.source, edge.target]),
    ]);
    const previous = previousView.current;
    const same =
      previous?.key === key && previous.instance === reactFlowInstance;
    const current = {
      key,
      instance: reactFlowInstance,
      fitted: same ? previous.fitted : false,
    };
    previousView.current = current;
    setNodes(
      same
        ? refreshGraph(finalNodes, nodesRef.current, selectedNode).nodes
        : finalNodes
    );
    setEdges(layoutEdges);
    if (!reactFlowInstance || current.fitted) return;
    const timer = setTimeout(() => {
      reactFlowInstance.fitView({
        padding: 0.2,
        duration: 0,
        nodes: sectioned
          ? finalNodes.filter(
              (node) =>
                !node.id.startsWith("role-") &&
                !node.data.kernelInactive &&
                !["roles", "inactive"].includes(node.data.sectionId)
            )
          : finalNodes,
      });
      current.fitted = true;
    }, 10);
    return () => clearTimeout(timer);
  }, [
    canonicalGraph,
    selectedChainId,
    selectedNode,
    architectureView,
    connectionFilters,
    reactFlowInstance,
    setNodes,
    setEdges,
  ]);

  // Add initialization effect back
  useEffect(() => {
    if (!initialized && !layouting && contracts && roles && roleAssignments) {
      setupGraph();
    }
  }, [initialized, layouting, contracts, roles, roleAssignments, setupGraph]);

  // Fix type for handleNodeClick
  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => {
      setSelectedNode((prevSelected) =>
        prevSelected === node.id ? null : node.id
      );
    },
    [setSelectedNode]
  );

  const graphIsLoading = isLoading || layouting;

  // Render tooltip for hovered assignee
  const renderAssigneeTooltip = () => {
    if (!selectedNode?.startsWith("0x") || !roleAssignments) return null;

    // Extract assignee address from node ID
    const assigneeAddress = selectedNode;

    // Find the node data
    const selectedNodeData = nodes.find(
      (node) => node.id === selectedNode
    )?.data;
    if (!selectedNodeData) return null;

    // Find all roles for this assignee
    const assignedRoles = roleAssignments
      .filter((a) => a.assignee.toLowerCase() === assigneeAddress.toLowerCase())
      .map((a) => a.role);

    // Get assignee name from the node data label
    const assigneeName = selectedNodeData.name;

    return (
      <div
        className="fixed bg-white shadow-lg rounded-lg p-4 min-w-[300px] border border-gray-200"
        style={{
          zIndex: 9999,
          top: "20px",
          right: "20px",
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-sm">{assigneeName}</h3>
          <div className="flex items-center">
            <span className="text-xs px-2 py-1 bg-pink-100 text-pink-800 rounded-full mr-2">
              Assignee
            </span>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="text-gray-500 hover:text-gray-700"
              aria-label="Close tooltip"
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
        <div className="text-xs text-gray-500 mb-2">
          <a
            href={getEtherscanLink(assigneeAddress, selectedChainId)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {assigneeAddress}
          </a>
        </div>
        <div className="border-t border-gray-200 my-2 pt-2">
          <h4 className="font-semibold text-sm mb-2">Assigned Roles:</h4>
          <div className="text-sm">
            {assignedRoles.length > 0 ? (
              <ul className="list-disc pl-4">
                {assignedRoles.map((role) => (
                  <li key={role} className="text-xs mb-1">
                    <button
                      type="button"
                      className="text-purple-600 hover:text-purple-800 hover:underline text-left"
                      onClick={() => setSelectedNode(`role-${role}`)}
                    >
                      {role}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-gray-500">No roles assigned</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Render tooltip for hovered role
  const renderRoleTooltip = () => {
    if (!selectedNode?.startsWith("role-") || !roleAssignments || !contracts)
      return null;

    // Extract role name from node ID
    const roleName = selectedNode.replace("role-", "");

    // Find all assignees for this role
    const assignees = roleAssignments
      .filter((a) => a.role === roleName)
      .map((a) => {
        const contract = contracts.find(
          (contract) => contract.address === a.assignee.toLowerCase()
        );
        return {
          address: a.assignee,
          name: contract ? formatContractName(contract) : a.assigneeName,
        };
      });

    // Find all policies that use this role
    const policiesUsingRole = contracts
      .filter(
        (c) =>
          c.type === "policy" &&
          Array.isArray(c.policyFunctions) &&
          (c.policyFunctions as Array<{ roles: string[]; name: string }>).some(
            (func) => func.roles.includes(roleName)
          )
      )
      .map((policy) => {
        // Get the specific functions that use this role
        const functions = (policy.policyFunctions as PolicyFunction[]).filter(
          (func) => func.roles.includes(roleName)
        );

        return {
          name: formatContractName(policy),
          address: policy.address,
          functions,
        };
      });

    return (
      <div
        className="fixed bg-white shadow-lg rounded-lg p-4 min-w-[350px] max-w-[450px] border border-gray-200"
        style={{
          zIndex: 9999,
          top: "20px",
          right: "20px",
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-sm">{roleName}</h3>
          <div className="flex items-center">
            <span className="text-xs px-2 py-1 bg-purple-100 text-purple-800 rounded-full mr-2">
              Role
            </span>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="text-gray-500 hover:text-gray-700"
              aria-label="Close tooltip"
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Assignees Section */}
        <div className="border-t border-gray-200 my-2 pt-2">
          <h4 className="font-semibold text-sm mb-2">
            Assignees ({assignees.length}):
          </h4>
          <div className="text-sm max-h-[120px] overflow-y-auto">
            {assignees.length > 0 ? (
              <ul className="list-disc pl-4">
                {assignees.map((assignee) => (
                  <li key={assignee.address} className="text-xs mb-1">
                    <button
                      type="button"
                      className="text-pink-600 hover:text-pink-800 hover:underline text-left"
                      onClick={() =>
                        setSelectedNode(assignee.address.toLowerCase())
                      }
                    >
                      {assignee.name === "UNKNOWN"
                        ? "Unknown address"
                        : assignee.name}
                    </button>
                    <a
                      href={getEtherscanLink(assignee.address, selectedChainId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-500 hover:underline ml-1"
                    >
                      ({shortenAddress(assignee.address)})
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-gray-500">No assignees</div>
            )}
          </div>
        </div>

        {/* Policies Section */}
        <div className="border-t border-gray-200 my-2 pt-2">
          <h4 className="font-semibold text-sm mb-2">
            Policies ({policiesUsingRole.length}):
          </h4>
          <div className="text-sm max-h-[150px] overflow-y-auto">
            {policiesUsingRole.length > 0 ? (
              <ul className="list-none">
                {policiesUsingRole.map((policy) => (
                  <li
                    key={policy.address}
                    className="mb-2 pb-2 border-b border-gray-100 last:border-b-0"
                  >
                    <div className="font-medium text-xs text-green-700 mb-1">
                      <button
                        type="button"
                        className="hover:underline text-left"
                        onClick={() => setSelectedNode(policy.address)}
                      >
                        {policy.name}
                      </button>
                    </div>
                    <a
                      href={getEtherscanLink(policy.address, selectedChainId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-gray-500 hover:underline"
                    >
                      {shortenAddress(policy.address)}
                    </a>
                    {policy.functions.length > 0 && (
                      <div className="mt-1">
                        <div className="text-xs text-gray-600">Functions:</div>
                        <ul className="list-disc pl-4">
                          {policy.functions.map((func) => (
                            <li
                              key={
                                func.canonicalSignature ??
                                func.signature ??
                                func.name
                              }
                              className="text-xs text-blue-600"
                            >
                              {func.canonicalSignature ??
                                func.signature ??
                                func.name}
                              <FunctionDocumentation
                                value={func.documentation}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-gray-500">No policies use this role</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Render tooltip for policy
  const renderPolicyTooltip = () => {
    if (!selectedNode?.startsWith("0x") || !contracts) return null;

    const contract = contracts.find(
      (c) => c.address === selectedNode && c.type === "policy"
    ) as Contract | undefined;
    if (!contract?.policyPermissions) return null;

    // Create a mapping of module keycodes to module contracts
    const moduleKeycodeToContract = new Map<string, Contract>();
    contracts.forEach((c) => {
      if (c.type === "module") {
        const keycode = extractKeycode(c.name);
        if (keycode) {
          moduleKeycodeToContract.set(keycode, c);
        }
      }
    });

    // Group policy permissions by keycode
    const permissionsByKeycode = new Map<string, PolicyPermission[]>();
    (contract.policyPermissions as PolicyPermission[]).forEach((permission) => {
      if (!permissionsByKeycode.has(permission.keycode)) {
        permissionsByKeycode.set(permission.keycode, []);
      }
      permissionsByKeycode.get(permission.keycode)?.push(permission);
    });

    // Get unique keycodes from policy permissions
    const uniqueKeycodes = Array.from(permissionsByKeycode.keys());

    return (
      <div
        className="fixed bg-white shadow-lg rounded-lg p-4 min-w-[350px] max-w-[450px] border border-gray-200"
        style={{
          zIndex: 9999,
          top: "20px",
          right: "20px",
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-sm">{formatContractName(contract)}</h3>
          <div className="flex items-center">
            <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full mr-2">
              Policy
            </span>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="text-gray-500 hover:text-gray-700"
              aria-label="Close tooltip"
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
        <div className="text-xs text-gray-500 mb-3">
          <a
            href={getEtherscanLink(contract.address, selectedChainId)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {contract.address}
          </a>
        </div>
        <div className="text-xs text-gray-600 mb-3">
          Last Updated:{" "}
          {new Date(
            Number(contract.lastUpdatedTimestamp) * 1000
          ).toLocaleString()}
        </div>
        <div className="border-t border-gray-200 my-2 pt-2">
          <h4 className="font-semibold text-sm mb-2">
            Modules Used ({uniqueKeycodes.length}):
          </h4>
          <div className="text-sm max-h-[250px] overflow-y-auto">
            <ul className="list-none divide-y divide-gray-100">
              {uniqueKeycodes.map((keycode) => {
                const moduleContract = moduleKeycodeToContract.get(keycode);
                const moduleFunctions = permissionsByKeycode.get(keycode) || [];

                return (
                  <li key={keycode} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center mb-1">
                      <div className="font-medium text-xs text-blue-700">
                        {moduleContract ? (
                          <button
                            type="button"
                            className="hover:underline text-left"
                            onClick={() =>
                              setSelectedNode(moduleContract.address)
                            }
                          >
                            {formatContractName(moduleContract)}
                          </button>
                        ) : (
                          <span>{keycode}</span>
                        )}
                      </div>
                      {moduleContract && (
                        <a
                          href={getEtherscanLink(
                            moduleContract.address,
                            selectedChainId
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-gray-500 hover:underline ml-2"
                        >
                          ({shortenAddress(moduleContract.address)})
                        </a>
                      )}
                    </div>
                    <div className="text-xs text-blue-600 mb-1">
                      Keycode: {keycode}
                    </div>
                    {moduleFunctions.length > 0 && (
                      <div className="mt-1">
                        <div className="text-xs text-gray-600 mb-1">
                          Functions:
                        </div>
                        <ul className="list-disc pl-4">
                          {moduleFunctions.map((func) => (
                            <li
                              key={`${keycode}-${func.function}`}
                              className="text-xs text-blue-600"
                            >
                              {func.function}
                              <FunctionDocumentation
                                value={func.functionContext}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    );
  };

  // Add a tooltip for module nodes
  const renderModuleTooltip = () => {
    if (!selectedNode?.startsWith("0x") || !contracts) return null;

    const moduleContract = contracts.find(
      (c) => c.address === selectedNode && c.type === "module"
    ) as Contract | undefined;
    if (!moduleContract) return null;

    // Find all policies that use this module
    const policiesUsingModule = contracts.filter(
      (c) =>
        c.type === "policy" &&
        c.policyPermissions &&
        Array.isArray(c.policyPermissions) &&
        moduleContract.name && // Check if name exists
        extractKeycode(moduleContract.name) && // Extract keycode from name
        (c.policyPermissions as Array<{ keycode: string }>).some(
          (p) => p.keycode === extractKeycode(moduleContract.name)
        )
    );

    return (
      <div
        className="fixed bg-white shadow-lg rounded-lg p-4 min-w-[350px] max-w-[450px] border border-gray-200"
        style={{
          zIndex: 9999,
          top: "20px",
          right: "20px",
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-sm">
            {formatContractName(moduleContract)}
          </h3>
          <div className="flex items-center">
            <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded-full mr-2">
              Module
            </span>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="text-gray-500 hover:text-gray-700"
              aria-label="Close tooltip"
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
        <div className="text-xs text-gray-500 mb-2">
          <a
            href={getEtherscanLink(moduleContract.address, selectedChainId)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {moduleContract.address}
          </a>
        </div>
        {extractKeycode(moduleContract.name) && (
          <div className="text-xs text-blue-600 mb-3">
            Keycode: {extractKeycode(moduleContract.name)}
          </div>
        )}
        <div className="border-t border-gray-200 my-2 pt-2">
          <h4 className="font-semibold text-sm mb-2">
            Policies Using This Module ({policiesUsingModule.length}):
          </h4>
          <div className="text-sm max-h-[150px] overflow-y-auto">
            {policiesUsingModule.length > 0 ? (
              <ul className="list-disc pl-4">
                {policiesUsingModule.map((policy) => (
                  <li key={policy.address} className="text-xs mb-1">
                    <button
                      type="button"
                      className="text-green-600 hover:text-green-800 hover:underline text-left"
                      onClick={() => setSelectedNode(policy.address)}
                    >
                      {formatContractName(policy)}
                    </button>
                    <a
                      href={getEtherscanLink(policy.address, selectedChainId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-500 hover:underline ml-1"
                    >
                      ({shortenAddress(policy.address)})
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-gray-500">No policies use this module</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (graphIsLoading && !initialized) {
    return (
      <div className="w-full h-[800px] flex items-center justify-center">
        Loading...
      </div>
    );
  }

  const selectedCoreContract = contracts?.find(
    (contract) => contract.address === selectedNode
  );
  const selectedContract =
    selectedCoreContract ??
    (selectedNode && data
      ? getAdditionalGraphContracts(data).find(
          (contract) => contract.address === selectedNode
        )
      : undefined);
  const selectedAddressNode = selectedNode?.startsWith("0x")
    ? nodes.find((node) => node.id === selectedNode)
    : undefined;
  const renderSelectedTooltip = () => {
    if (selectedAddressNode?.data.assigneeAddress)
      return renderAssigneeTooltip();
    if (selectedNode?.startsWith("role-")) return renderRoleTooltip();
    if (!selectedNode?.startsWith("0x")) return null;
    if (selectedCoreContract?.type === "policy") return renderPolicyTooltip();
    if (selectedCoreContract?.type === "module") return renderModuleTooltip();
    return null;
  };
  const selectedRelationships =
    data?.relationships.filter(
      (relationship) =>
        relationship.subject?.toLowerCase() === selectedNode ||
        relationship.source.toLowerCase() === selectedNode ||
        relationship.target?.toLowerCase() === selectedNode
    ) ?? [];
  const selectedState = data?.contractStates.find(
    (state) => state.address.toLowerCase() === selectedNode
  );
  const selectedControl = getEnablementPresentation(
    selectedState,
    data?.observation
  );
  const selectedTaskList = data?.periodicTasks.find(
    (list) => list.address.toLowerCase() === selectedNode
  );

  return (
    <div className="w-full">
      <ChainSelector
        selectedChainId={selectedChainId}
        onChainChange={setSelectedChainId}
      />
      {!isHistorical && (
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <label>
            View:{" "}
            <select
              aria-label="Architecture view"
              className="rounded border border-slate-300 bg-white p-1"
              value={architectureView}
              onChange={(event) => {
                setSelectedNode(null);
                setArchitectureView(event.target.value);
              }}
            >
              <option value="overview">Architecture sections</option>
              <option value="all">Unsectioned graph</option>
              {SUBSYSTEMS.filter((group) =>
                canonicalGraph?.nodes.some(
                  (node) => getSubsystem(node) === group.id
                )
              ).map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ["permission", "Role / module permissions"],
              ["control", "Ownership / control"],
              ["reference", "References"],
            ] as [ConnectionKind, string][]
          ).map(([kind, label]) => (
            <label key={kind} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={connectionFilters[kind]}
                onChange={(event) =>
                  setConnectionFilters((previous) => ({
                    ...previous,
                    [kind]: event.target.checked,
                  }))
                }
              />
              {label}
            </label>
          ))}
          {selectedNode && (
            <button
              type="button"
              className="text-blue-700 hover:underline"
              onClick={() => setSelectedNode(null)}
            >
              Back to {architectureView === "overview" ? "overview" : "view"}
            </button>
          )}
          <span>
            {nodes.filter((node) => node.type !== "group").length} nodes ·{" "}
            {edges.length} connections
          </span>
        </div>
      )}
      {navigationNotice && (
        <p role="status" className="mb-2 text-sm text-amber-800">
          {navigationNotice}
        </p>
      )}
      {error && data && !isHistorical && (
        <p role="status" className="mb-2 text-sm text-amber-800">
          Snapshot refresh failed. Showing the last loaded snapshot.
        </p>
      )}
      {!isHistorical && (data?.relationships.length ?? 0) > 0 && (
        <p className="mb-2 text-xs text-gray-500">
          Control and reference links are labelled. Dashed links show pending
          nominations. Missing links may reflect incomplete source coverage.
        </p>
      )}
      <div className="h-[800px] border border-gray-200 rounded-lg">
        {isHistorical ? (
          <div className="h-full overflow-auto p-4">
            <p className="mb-4 text-sm text-gray-600">
              Historical network. Recorded deployments are shown below; live
              indexing and contract state are unavailable.
            </p>
            <ul className="space-y-3">
              {otherContracts
                .filter(
                  (contract) =>
                    contract.chainId === selectedChainId && !contract.labelOnly
                )
                .map((contract) => (
                  <li
                    key={contract.address}
                    id={`inventory-${contract.address}`}
                    className={`border-b border-gray-200 pb-2 ${selectedNode === contract.address ? "bg-blue-50" : ""}`}
                  >
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      aria-pressed={selectedNode === contract.address}
                      onClick={() => setSelectedNode(contract.address)}
                    >
                      {contract.name}
                    </button>
                    <code className="break-all text-xs text-gray-600">
                      {contract.address}
                    </code>
                  </li>
                ))}
            </ul>
          </div>
        ) : error && !data ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="max-w-md text-center">
              <div className="text-lg font-semibold">
                Unable to load protocol data
              </div>
              <div className="mt-2 text-sm text-gray-600">
                {error instanceof Error
                  ? error.message
                  : "The protocol snapshot request failed."}
              </div>
            </div>
          </div>
        ) : hasNoContractData ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-lg">No contract data found</div>
          </div>
        ) : (
          <>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              minZoom={0.2}
              maxZoom={1.5}
              defaultViewport={{ x: 0, y: 0, zoom: 0.7 }}
              onInit={(instance: ReactFlowInstance<NodeData>) => {
                setReactFlowInstance(instance);
              }}
              elementsSelectable={true}
              nodesConnectable={false}
              nodesDraggable={true}
              edgesFocusable={true}
              edgesUpdatable={false}
              onNodeClick={handleNodeClick}
              onNodeDragStop={(_event: unknown, node: Node<NodeData>) => {
                const updatedNodes = nodes.map((n) =>
                  n.id === node.id ? { ...n, position: node.position } : n
                );
                setNodes(updatedNodes);
              }}
              onPaneClick={() => {
                setSelectedNode(null);
              }}
            >
              <Background />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
            {renderSelectedTooltip()}
            {(selectedContract || selectedAddressNode) && selectedNode && (
              <aside
                className="fixed bottom-4 right-4 z-50 max-w-[min(420px,calc(100vw-2rem))] max-h-[40vh] overflow-auto rounded-lg border border-gray-200 bg-white p-4 text-xs shadow-lg"
                aria-label="Contract control state"
              >
                <div className="flex justify-between gap-4">
                  <strong>
                    {selectedContract
                      ? getGraphContractName(selectedContract)
                      : selectedAddressNode?.data.name}
                  </strong>
                  <button
                    type="button"
                    onClick={() => setSelectedNode(null)}
                    aria-label="Close control details"
                  >
                    ×
                  </button>
                </div>
                <a
                  className="mt-1 block break-all text-blue-600"
                  href={getEtherscanLink(selectedNode, selectedChainId)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {selectedNode}
                </a>
                {selectedContract && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-1.5">
                      <ContractStatusIcons
                        contract={selectedContract}
                        enablementLabel={null}
                      />
                      {getKernelLabel(selectedContract) ??
                        getContractDeploymentLabel(selectedContract)}
                    </span>
                    {selectedControl.badge && (
                      <span className="inline-flex items-center gap-1.5">
                        <EnablementIndicator label={selectedControl.badge} />
                        {selectedControl.badge === "Contract enabled"
                          ? "Enabled"
                          : "Disabled"}
                      </span>
                    )}
                  </div>
                )}
                {selectedControl.warning && (
                  <p className="mt-2 text-amber-800 break-all">
                    {selectedControl.warning}
                  </p>
                )}
                {selectedTaskList && (
                  <section
                    className="mt-3 border-t border-gray-200 pt-2"
                    aria-label="Periodic tasks"
                  >
                    <h4 className="font-semibold">
                      Periodic tasks
                      {selectedTaskList.tasks !== null
                        ? ` (${selectedTaskList.tasks.length})`
                        : ""}
                    </h4>
                    <p className="mt-1 text-gray-500">
                      Invocation order; disabled tasks remain configured.
                    </p>
                    {selectedTaskList.tasks === null ? (
                      <p className="mt-2 text-amber-800">
                        Task configuration is unknown.
                      </p>
                    ) : selectedTaskList.tasks.length === 0 ? (
                      <p className="mt-2 text-gray-500">No tasks configured.</p>
                    ) : (
                      <ol className="mt-2 space-y-2">
                        {selectedTaskList.tasks.map((task, index) => {
                          const contract =
                            contracts?.find(
                              (contract) => contract.address === task.address
                            ) ??
                            data?.additionalContracts.find(
                              (contract) => contract.address === task.address
                            );
                          const state = data?.contractStates.find(
                            (state) => state.address === task.address
                          );
                          const enabled = getEnablementPresentation(
                            state,
                            data?.observation
                          );
                          return (
                            <li
                              key={task.address}
                              className="flex items-start gap-2"
                            >
                              <span className="text-gray-500 tabular-nums">
                                {index + 1}.
                              </span>
                              <div className="min-w-0 flex-1">
                                <button
                                  type="button"
                                  className="text-left text-blue-600 hover:underline break-all"
                                  onClick={() => setSelectedNode(task.address)}
                                >
                                  {contract
                                    ? getGraphContractName(contract)
                                    : shortenAddress(task.address)}
                                </button>
                                <code className="mt-0.5 block break-all text-gray-600">
                                  {task.selector === "0x00000000"
                                    ? "execute()"
                                    : (task.signature ?? task.selector)}
                                </code>
                              </div>
                              {enabled.badge ? (
                                <EnablementIndicator label={enabled.badge} />
                              ) : (
                                <span
                                  className="text-gray-500"
                                  title="No task-local enablement observation"
                                >
                                  Unknown
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    )}
                    {selectedTaskList.verification.outcome !== "match" && (
                      <p className="mt-2 text-amber-800">
                        Task configuration verification:{" "}
                        {selectedTaskList.verification.outcome}. Indexed order
                        is retained.
                      </p>
                    )}
                    {selectedTaskList.indexedThrough && (
                      <p className="mt-2 text-gray-500">
                        Indexed through block{" "}
                        {selectedTaskList.indexedThrough.number}.
                      </p>
                    )}
                  </section>
                )}
                {selectedContract && (
                  <>
                    {selectedControl.notices.map((notice) => (
                      <p key={notice} className="mt-2 text-amber-800">
                        {notice}
                      </p>
                    ))}
                    <details key={selectedNode} className="mt-2">
                      <summary className="cursor-pointer text-gray-500">
                        Indexing &amp; verification
                      </summary>
                      {selectedControl.details
                        .filter((detail) => detail !== selectedControl.warning)
                        .map((detail) => (
                          <p
                            key={detail}
                            className="mt-2 break-all text-gray-600"
                          >
                            {detail}
                          </p>
                        ))}
                    </details>
                  </>
                )}
                {selectedRelationships.length > 0 && (
                  <section
                    className="mt-3 border-t border-gray-200 pt-2"
                    aria-label="Control relationships"
                  >
                    <h4 className="font-semibold">
                      Relationships ({selectedRelationships.length})
                    </h4>
                    {selectedRelationships.map((relationship) => (
                      <div
                        key={relationship.id}
                        className="mt-2 border-t border-gray-100 pt-2"
                      >
                        <strong>
                          {relationship.status === "pending" ? "Pending " : ""}
                          {relationship.callSignature ??
                            relationship.functionContext?.signature ??
                            relationship.kind.replace(/-/g, " ")}
                        </strong>
                        <FunctionDocumentation
                          value={relationship.functionContext}
                        />
                        {relationship.targetCode && (
                          <p className="mt-1 text-gray-500">
                            {relationship.targetCode === "present"
                              ? "Target has deployed code at the observation block."
                              : "Target has no code at the observation block; address type is not inferred."}
                          </p>
                        )}
                        {relationship.target ? (
                          <p className="mt-1 break-all">
                            {getRelationshipPath(relationship).map(
                              (address, index) => (
                                <span key={address}>
                                  {index > 0 && " → "}
                                  <a
                                    className="text-blue-600"
                                    href={getEtherscanLink(
                                      address,
                                      selectedChainId
                                    )}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={address}
                                  >
                                    {shortenAddress(address)}
                                  </a>
                                </span>
                              )
                            )}
                          </p>
                        ) : (
                          <p>
                            {relationship.value == null
                              ? "Unknown; no successful observation establishes this field."
                              : relationship.getter?.startsWith("new")
                                ? "No pending nomination."
                                : relationship.kind === "registered-pool"
                                  ? "OHM is unregistered; no pool is selected."
                                  : "Unset."}
                          </p>
                        )}
                        <details className="mt-1">
                          <summary className="cursor-pointer text-gray-500">
                            Evidence
                          </summary>
                          {relationship.scope && (
                            <p className="mt-1 break-all text-gray-500">
                              Registry: {relationship.scope.registry}; token:{" "}
                              {relationship.scope.token}.
                            </p>
                          )}
                          {relationship.status === "reference" &&
                            relationship.getter && (
                              <p className="mt-1 text-gray-500">
                                Address reference from{" "}
                                {relationship.getter.split(":")[0]}(
                                {relationship.scope?.token}).
                              </p>
                            )}
                          <p className="mt-1 break-all text-gray-500">
                            Observed at block {relationship.provenance.number} (
                            {relationship.provenance.hash})
                            {"transactionHash" in relationship.provenance
                              ? `; transaction ${relationship.provenance.transactionHash}, log ${relationship.provenance.logIndex}`
                              : "; getter observation"}
                            .
                          </p>
                          {relationship.indexedThrough && (
                            <p className="mt-1 text-gray-500">
                              Indexed through block{" "}
                              {relationship.indexedThrough.number}.
                            </p>
                          )}
                          {relationship.verification?.outcome === "match" && (
                            <p className="mt-1 text-gray-500">
                              Getter matches at block{" "}
                              {relationship.verification.block?.number}.
                            </p>
                          )}
                          {relationship.status === "reference" &&
                            relationship.coverage && (
                              <p className="mt-1 text-gray-500">
                                {relationship.coverage}
                              </p>
                            )}
                        </details>
                        {relationship.lastChange &&
                          (!relationship.indexedThrough ||
                            BigInt(relationship.lastChange.number) >
                              BigInt(relationship.indexedThrough.number)) && (
                            <p className="mt-1 text-amber-800">
                              Latest relationship change awaits a completed
                              verification checkpoint.
                            </p>
                          )}
                        {data?.observation &&
                          (!relationship.indexedThrough ||
                            BigInt(relationship.indexedThrough.number) <
                              BigInt(
                                data.observation.indexedThrough.number
                              )) && (
                            <p className="mt-1 text-amber-800">
                              Relationship coverage is behind chain observation
                              block {data.observation.indexedThrough.number}.
                            </p>
                          )}
                        {relationship.status !== "reference" &&
                          relationship.coverage && (
                            <p className="mt-1 text-amber-800">
                              {relationship.coverage}
                            </p>
                          )}
                        {relationship.verification?.outcome === "mismatch" && (
                          <p className="mt-1 break-all text-amber-800">
                            Verification mismatch: indexed {relationship.value},
                            getter {relationship.verification.getterValue} at
                            block {relationship.verification.block?.number} (
                            {relationship.verification.block?.hash}). Indexed
                            state is retained.
                          </p>
                        )}
                        {relationship.verification?.outcome ===
                          "unavailable" && (
                          <p className="mt-1 text-amber-800">
                            Getter verification unavailable at block{" "}
                            {relationship.verification.block?.number}.
                            Established indexed state is retained.
                          </p>
                        )}
                      </div>
                    ))}
                  </section>
                )}
              </aside>
            )}
          </>
        )}
      </div>
    </div>
  );
}
