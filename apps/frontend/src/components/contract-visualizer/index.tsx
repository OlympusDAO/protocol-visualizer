import { useCallback, useEffect, useState, useRef } from "react";
import ReactFlow, {
  Background,
  Controls,
  Node,
  useEdgesState,
  useNodesState,
  NodeTypes,
  Edge,
  Position,
  Handle,
  MarkerType,
  ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import { usePonderQuery } from "@ponder/react";
import { schema } from "@/lib/ponder";
import { Contract } from "@/services/contracts";
import { eq } from "@ponder/client";
import dagre from "dagre";

// Types
type RoleAssignment = typeof schema.roleAssignment.$inferSelect;

interface NodeData {
  label: React.ReactNode;
  assignees?: RoleAssignment[];
  policiesCount?: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  assigneeAddress?: string;
  modulesUsedCount?: number;
}

type CustomNode = Node<NodeData>;

// Helper functions
const shortenAddress = (address: string) => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const getEtherscanLink = (address: string) => {
  return `https://etherscan.io/address/${address}`;
};

// Extract keycode from module name (e.g., "MINTR" from "MINTR: Minter")
const extractKeycode = (moduleName: string): string | null => {
  const match = moduleName.match(/^[A-Z0-9]{1,5}/);
  return match ? match[0] : null;
};

// Node color scheme
const NODE_COLORS = {
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

// Create a node for a non-contract assignee
const createAssigneeNode = (assignee: RoleAssignment, id: string) => {
  return {
    id,
    data: {
      label: (
        <div className="p-1 text-sm relative">
          <Handle
            id={`${id}-target`}
            type="target"
            position={Position.Left}
            style={{
              background: NODE_COLORS.assignee.border,
              border: `1px solid ${NODE_COLORS.assignee.border}`,
            }}
          />
          <div
            className="font-bold mb-1 break-words whitespace-pre-wrap max-w-[160px]"
            style={{ color: NODE_COLORS.assignee.text }}
          >
            {assignee.assigneeName === "UNKNOWN"
              ? "EOA"
              : assignee.assigneeName}
          </div>
          <a
            href={getEtherscanLink(assignee.assignee)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs break-all hover:opacity-80"
            style={{ color: NODE_COLORS.assignee.border }}
          >
            {shortenAddress(assignee.assignee)}
          </a>
          <Handle
            id={`${id}-source`}
            type="source"
            position={Position.Right}
            style={{
              background: NODE_COLORS.assignee.border,
              border: `1px solid ${NODE_COLORS.assignee.border}`,
            }}
          />
        </div>
      ),
      assigneeAddress: assignee.assignee,
    },
    style: {
      background: NODE_COLORS.assignee.background,
      border: `1px solid ${NODE_COLORS.assignee.border}`,
      borderRadius: "8px",
      padding: "6px",
      minWidth: "180px",
    },
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
  };
};

// Node types configuration
const nodeTypes: NodeTypes = {
  role: ({ data }: { data: NodeData }) => (
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
      <h3 className="font-bold text-sm mb-2">{contract.name}</h3>
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
          ).map((keycode, index) => (
            <li key={index} className="text-xs mb-1">
              <span className="text-blue-600">{keycode}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

// Add dagre layout function
const getLayoutedElements = (
  nodes: Node[],
  edges: Edge[],
  direction = "TB"
) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = 180;
  const nodeHeight = 100;

  // Set graph direction and spacing
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 80,
    ranksep: 150,
    marginx: 100,
    marginy: 100,
  });

  // Add nodes to dagre graph
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: nodeWidth,
      height: node.type === "role" ? 80 : nodeHeight,
    });
  });

  // Add edges to dagre graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Calculate layout
  dagre.layout(dagreGraph);

  // Get positioned nodes
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - (node.type === "role" ? 40 : nodeHeight / 2),
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

export function ContractVisualizer() {
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [hoveredPolicy, setHoveredPolicy] = useState<string | null>(null);
  const [hoveredRole, setHoveredRole] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [layouting, setLayouting] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [originalLayout, setOriginalLayout] = useState<{
    nodes: CustomNode[];
    edges: Edge[];
  } | null>(null);

  // Add ref for ReactFlow instance
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

  // Query contracts
  const { data: contracts, isLoading: isLoadingContracts } = usePonderQuery({
    queryFn: (db) =>
      db
        .select()
        .from(schema.contract)
        .where(eq(schema.contract.isEnabled, true)),
  });

  // Query roles and assignments
  const { data: roles, isLoading: isLoadingRoles } = usePonderQuery({
    queryFn: (db) => db.select().from(schema.role),
  });

  const { data: roleAssignments, isLoading: isLoadingAssignments } =
    usePonderQuery({
      queryFn: (db) =>
        db
          .select()
          .from(schema.roleAssignment)
          .where(eq(schema.roleAssignment.isGranted, true)),
    });

  const createNodeFromContract = useCallback(
    (contract: Contract, id: string) => {
      const type = contract.type;
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
          label: (
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
              <div
                className="font-bold mb-1 break-words whitespace-pre-wrap max-w-[160px]"
                style={{ color: colors.text }}
              >
                {contract.name}
              </div>
              <a
                href={getEtherscanLink(contract.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs break-all hover:opacity-80"
                style={{ color: colors.border }}
              >
                {shortenAddress(contract.address)}
              </a>
              {!contract.isEnabled && (
                <div className="text-xs mt-1 text-red-500">Disabled</div>
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
          minWidth: "180px",
          zIndex: hoveredPolicy === contract.address ? 1000 : 1,
        },
        targetPosition: Position.Left,
        sourcePosition: Position.Right,
      };
    },
    [hoveredPolicy]
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
        style: {
          stroke: edgeColor,
          strokeWidth: 2,
          opacity: 0.1,
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
        const contractNode = contracts.find(
          (c) => c.address.toLowerCase() === assignment.assignee.toLowerCase()
        );

        if (contractNode) {
          // Add edge to existing contract node
          newEdges.push(createEdge(assignment.assignee, roleId, false));
        } else {
          // Create node for non-contract assignee
          const assigneeId = `assignee-${assignment.assignee}`;
          newNodes.push({
            ...createAssigneeNode(assignment, assigneeId),
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
        const policyFunctions = policy.policyFunctions as Array<{
          roles: string[];
        }>;
        const hasRole = policyFunctions.some((func) =>
          func.roles.includes(role.role)
        );
        if (hasRole) {
          newEdges.push(createEdge(roleId, policy.address, false));
        }
      });
    });

    // Apply dagre layout
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      newNodes,
      newEdges,
      "TB"
    );

    // Store the original layout for resetting
    setOriginalLayout({ nodes: layoutedNodes, edges: layoutedEdges });

    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    setLayouting(false);
    setInitialized(true);
  }, [
    contracts,
    roles,
    roleAssignments,
    layouting,
    createNodeFromContract,
    createEdge,
    hoveredRole,
  ]);

  // Add function to get connected nodes
  const getConnectedNodes = useCallback(
    (nodeId: string) => {
      const connectedNodeIds = new Set<string>([nodeId]);

      // Add directly connected nodes through edges
      edges.forEach((edge) => {
        if (edge.source === nodeId) connectedNodeIds.add(edge.target);
        if (edge.target === nodeId) connectedNodeIds.add(edge.source);
      });

      return Array.from(connectedNodeIds);
    },
    [edges]
  );

  // Add effect to handle node selection and layout
  useEffect(() => {
    if (!selectedNode || !originalLayout || !reactFlowInstance.current) return;

    const connectedNodeIds = getConnectedNodes(selectedNode);

    // Calculate the center of the current view
    const { x: viewX, y: viewY } = reactFlowInstance.current.getViewport();

    // Create a subgraph of connected nodes
    const relevantNodes = nodes.map((node) => ({
      ...node,
      // Move unconnected nodes just outside the view
      position: connectedNodeIds.includes(node.id)
        ? node.position
        : {
            x: node.position.x + viewX + 800,
            y: node.position.y + viewY + 800,
          },
      style: {
        ...node.style,
        opacity: connectedNodeIds.includes(node.id) ? 1 : 0.2,
        transition: "all 0.5s ease-in-out",
      },
    }));

    // Filter edges to only show those connecting selected nodes
    const relevantEdges = edges.map((edge) => ({
      ...edge,
      style: {
        ...edge.style,
        opacity:
          connectedNodeIds.includes(edge.source) &&
          connectedNodeIds.includes(edge.target)
            ? 1
            : 0,
        transition: "all 0.5s ease-in-out",
      },
    }));

    // Re-layout the connected nodes to bring them closer
    const { nodes: layoutedNodes } = getLayoutedElements(
      relevantNodes.filter((node) => connectedNodeIds.includes(node.id)),
      relevantEdges.filter(
        (edge) =>
          connectedNodeIds.includes(edge.source) &&
          connectedNodeIds.includes(edge.target)
      ),
      "TB"
    );

    // Combine the layouts
    const finalNodes = relevantNodes.map((node) => {
      const layoutedNode = layoutedNodes.find((n) => n.id === node.id);
      return layoutedNode || node;
    });

    setNodes(finalNodes);
    setEdges(relevantEdges);

    // Fit view to connected nodes after a short delay to allow transition
    setTimeout(() => {
      if (reactFlowInstance.current) {
        reactFlowInstance.current.fitView({
          padding: 0.2,
          duration: 0,
          nodes: finalNodes.filter((node) =>
            connectedNodeIds.includes(node.id)
          ),
        });
      }
    }, 10);
  }, [selectedNode, originalLayout, getConnectedNodes, edges, nodes]);

  // Modify effect to reset layout when deselecting
  useEffect(() => {
    if (
      !selectedNode &&
      originalLayout &&
      initialized &&
      reactFlowInstance.current
    ) {
      const restoredNodes = originalLayout.nodes.map((node) => ({
        ...node,
        style: {
          ...node.style,
          opacity: 1,
          transition: "all 0.5s ease-in-out",
        },
      }));

      setNodes(restoredNodes);
      setEdges(originalLayout.edges);

      void setTimeout(() => {
        if (reactFlowInstance.current) {
          reactFlowInstance.current.fitView({
            padding: 0.2,
            duration: 800,
          });
        }
      }, 50);
    }
  }, [selectedNode, originalLayout, initialized]);

  // Add initialization effect back
  useEffect(() => {
    if (!initialized && !layouting && contracts && roles && roleAssignments) {
      setupGraph();
    }
  }, [initialized, layouting, contracts, roles, roleAssignments, setupGraph]);

  // Fix type for handleNodeClick
  const handleNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedNode((prevSelected) =>
      prevSelected === node.id ? null : node.id
    );
  }, []);

  const isLoading =
    isLoadingContracts || isLoadingRoles || isLoadingAssignments || layouting;

  // Render tooltip for hovered assignee
  const renderAssigneeTooltip = () => {
    if (
      !selectedNode ||
      !selectedNode.startsWith("assignee-") ||
      !roleAssignments
    )
      return null;

    // Extract assignee address from node ID
    const assigneeAddress = selectedNode.replace("assignee-", "");

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
    const assigneeName =
      typeof selectedNodeData.label === "string"
        ? selectedNodeData.label
        : "Unknown";

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
              onClick={() => setSelectedNode(null)}
              className="text-gray-500 hover:text-gray-700"
              aria-label="Close tooltip"
            >
              <svg
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
            href={getEtherscanLink(assigneeAddress)}
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
                {assignedRoles.map((role, index) => (
                  <li key={index} className="text-xs mb-1">
                    <button
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
    if (
      !selectedNode ||
      !selectedNode.startsWith("role-") ||
      !roleAssignments ||
      !contracts
    )
      return null;

    // Extract role name from node ID
    const roleName = selectedNode.replace("role-", "");

    // Find all assignees for this role
    const assignees = roleAssignments
      .filter((a) => a.role === roleName)
      .map((a) => ({
        address: a.assignee,
        name: a.assigneeName,
      }));

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
        const functions = (
          policy.policyFunctions as Array<{ roles: string[]; name: string }>
        )
          .filter((func) => func.roles.includes(roleName))
          .map((func) => func.name);

        return {
          name: policy.name,
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
              onClick={() => setSelectedNode(null)}
              className="text-gray-500 hover:text-gray-700"
              aria-label="Close tooltip"
            >
              <svg
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
                {assignees.map((assignee, index) => (
                  <li key={index} className="text-xs mb-1">
                    <button
                      className="text-pink-600 hover:text-pink-800 hover:underline text-left"
                      onClick={() =>
                        setSelectedNode(`assignee-${assignee.address}`)
                      }
                    >
                      {assignee.name === "UNKNOWN" ? "EOA" : assignee.name}
                    </button>
                    <a
                      href={getEtherscanLink(assignee.address)}
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
                {policiesUsingRole.map((policy, index) => (
                  <li
                    key={index}
                    className="mb-2 pb-2 border-b border-gray-100 last:border-b-0"
                  >
                    <div className="font-medium text-xs text-green-700 mb-1">
                      <button
                        className="hover:underline text-left"
                        onClick={() => setSelectedNode(policy.address)}
                      >
                        {policy.name}
                      </button>
                    </div>
                    <a
                      href={getEtherscanLink(policy.address)}
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
                          {policy.functions.map((func, idx) => (
                            <li key={idx} className="text-xs text-blue-600">
                              {func}
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
    if (!selectedNode || !selectedNode.startsWith("0x") || !contracts)
      return null;

    const contract = contracts.find(
      (c) => c.address === selectedNode && c.type === "policy"
    ) as Contract | undefined;
    if (!contract || !contract.policyPermissions) return null;

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
    const permissionsByKeycode = new Map<string, Array<{ function: string }>>();
    (
      contract.policyPermissions as Array<{ keycode: string; function: string }>
    ).forEach((permission) => {
      if (!permissionsByKeycode.has(permission.keycode)) {
        permissionsByKeycode.set(permission.keycode, []);
      }
      permissionsByKeycode
        .get(permission.keycode)
        ?.push({ function: permission.function });
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
          <h3 className="font-bold text-sm">{contract.name}</h3>
          <div className="flex items-center">
            <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full mr-2">
              Policy
            </span>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-gray-500 hover:text-gray-700"
              aria-label="Close tooltip"
            >
              <svg
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
            href={getEtherscanLink(contract.address)}
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
              {uniqueKeycodes.map((keycode, index) => {
                const moduleContract = moduleKeycodeToContract.get(keycode);
                const moduleFunctions = permissionsByKeycode.get(keycode) || [];

                return (
                  <li key={index} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center mb-1">
                      <div className="font-medium text-xs text-blue-700">
                        {moduleContract ? (
                          <button
                            className="hover:underline text-left"
                            onClick={() =>
                              setSelectedNode(moduleContract.address)
                            }
                          >
                            {moduleContract.name}
                          </button>
                        ) : (
                          <span>{keycode}</span>
                        )}
                      </div>
                      {moduleContract && (
                        <a
                          href={getEtherscanLink(moduleContract.address)}
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
                          {moduleFunctions.map((func, idx) => (
                            <li key={idx} className="text-xs text-blue-600">
                              {func.function}
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
    if (!selectedNode || !selectedNode.startsWith("0x") || !contracts)
      return null;

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
          <h3 className="font-bold text-sm">{moduleContract.name}</h3>
          <div className="flex items-center">
            <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded-full mr-2">
              Module
            </span>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-gray-500 hover:text-gray-700"
              aria-label="Close tooltip"
            >
              <svg
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
            href={getEtherscanLink(moduleContract.address)}
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
                {policiesUsingModule.map((policy, index) => (
                  <li key={index} className="text-xs mb-1">
                    <button
                      className="text-green-600 hover:text-green-800 hover:underline text-left"
                      onClick={() => setSelectedNode(policy.address)}
                    >
                      {policy.name}
                    </button>
                    <a
                      href={getEtherscanLink(policy.address)}
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

  if (isLoading && !initialized) {
    return (
      <div className="w-full h-[800px] flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <div className="w-full h-[800px] border border-gray-200 rounded-lg">
      {!contracts || contracts.length === 0 ? (
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-lg">No contracts found</div>
        </div>
      ) : (
        <>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.2}
            maxZoom={1.5}
            defaultViewport={{ x: 0, y: 0, zoom: 0.7 }}
            onInit={(instance) => {
              reactFlowInstance.current = instance;
            }}
            elementsSelectable={true}
            nodesConnectable={false}
            nodesDraggable={true}
            edgesFocusable={true}
            edgesUpdatable={false}
            onNodeClick={handleNodeClick}
            onNodeDragStop={(_event, node) => {
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
          </ReactFlow>
          {selectedNode?.startsWith("assignee-")
            ? renderAssigneeTooltip()
            : selectedNode?.startsWith("role-")
              ? renderRoleTooltip()
              : selectedNode?.startsWith("0x") &&
                  contracts.find((c) => c.address === selectedNode)?.type ===
                    "policy"
                ? renderPolicyTooltip()
                : selectedNode?.startsWith("0x") &&
                    contracts.find((c) => c.address === selectedNode)?.type ===
                      "module"
                  ? renderModuleTooltip()
                  : null}
        </>
      )}
    </div>
  );
}
