import { useCallback, useEffect, useState } from "react";
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
} from "reactflow";
import "reactflow/dist/style.css";
import { usePonderQuery } from "@ponder/react";
import { schema } from "@/lib/ponder";
import { Contract } from "@/services/contracts";
import { eq } from "@ponder/client";
import ELK from 'elkjs/lib/elk.bundled.js';

// Initialize ELK
const elk = new ELK();

// Types
type RoleAssignment = typeof schema.roleAssignment.$inferSelect;

// Helper functions
const shortenAddress = (address: string) => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const getEtherscanLink = (address: string) => {
  return `https://etherscan.io/address/${address}`;
};

// Node color scheme
const NODE_COLORS = {
  kernel: {
    background: '#fef3c7', // Amber 100
    border: '#d97706',     // Amber 600
    text: '#92400e'        // Amber 800
  },
  module: {
    background: '#dbeafe', // Blue 100
    border: '#2563eb',     // Blue 600
    text: '#1e40af'        // Blue 800
  },
  policy: {
    background: '#dcfce7', // Green 100
    border: '#16a34a',     // Green 600
    text: '#166534'        // Green 800
  },
  role: {
    background: '#f3e8ff', // Purple 100
    border: '#9333ea',     // Purple 600
    text: '#6b21a8'        // Purple 800
  },
  assignee: {
    background: '#fae8ff', // Pink 100
    border: '#db2777',     // Pink 600
    text: '#9d174d'        // Pink 800
  }
};

// Create a node for a non-contract assignee
const createAssigneeNode = (
  assignee: RoleAssignment,
  id: string
) => {
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
          <div className="font-bold mb-1 break-words whitespace-pre-wrap max-w-[160px]" style={{ color: NODE_COLORS.assignee.text }}>
            {assignee.assigneeName === "UNKNOWN" ? "EOA" : assignee.assigneeName}
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
      assigneeAddress: assignee.assignee
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
  role: ({ data }) => (
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
      <div className="font-bold mb-2" style={{ color: NODE_COLORS.role.text }}>{data.label}</div>
      {data.assignees && (
        <div className="text-xs" style={{ color: NODE_COLORS.role.border }}>
          {data.assignees.length} Active Assignee(s)
        </div>
      )}
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

// TODOs
// [X] Display last update, etc on hover over a node
// [X] Click on a policy node to show the policy permissions
// [ ] Click on a module node to show policy permissions that are using that module

export function ContractVisualizer() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [hoveredPolicy, setHoveredPolicy] = useState<string | null>(null);
  const [hoveredRole, setHoveredRole] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [layouting, setLayouting] = useState(false);
  const [initialized, setInitialized] = useState(false);

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
    queryFn: (db) =>
      db
        .select()
        .from(schema.role),
  });

  const { data: roleAssignments, isLoading: isLoadingAssignments } = usePonderQuery({
    queryFn: (db) =>
      db
        .select()
        .from(schema.roleAssignment)
        .where(eq(schema.roleAssignment.isGranted, true)),
  });

  const createNodeFromContract = useCallback(
    (contract: Contract, id: string) => {
      const type = contract.type;
      const colors = type === 'kernel' ? NODE_COLORS.kernel :
                    type === 'module' ? NODE_COLORS.module :
                    NODE_COLORS.policy;

      return {
        id,
        data: {
          label: (
            <div
              className="p-1 text-sm relative"
              style={{ position: "relative" }}
              onMouseEnter={() =>
                type === 'policy' && setHoveredPolicy(contract.address)
              }
              onMouseLeave={() => type === 'policy' && setHoveredPolicy(null)}
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
              <div className="font-bold mb-1 break-words whitespace-pre-wrap max-w-[160px]" style={{ color: colors.text }}>
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
              {type === 'policy' && hoveredPolicy === contract.address && (
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
  const createEdge = useCallback((source: string, target: string, animated: boolean = false) => {
    const sourceIsRole = source.startsWith('role-');
    const targetIsRole = target.startsWith('role-');
    const targetIsPolicy = target.startsWith('0x') && !source.startsWith('0x');

    // Use green for role -> policy edges, purple for others
    const edgeColor = targetIsPolicy ? NODE_COLORS.policy.border : NODE_COLORS.role.border;

    return {
      id: `${source}-${target}`,
      source,
      target,
      sourceHandle: sourceIsRole ? 'role-source' : `${source}-source`,
      targetHandle: targetIsRole ? 'role-target' : `${target}-target`,
      type: "smoothstep",
      style: {
        stroke: edgeColor,
        strokeWidth: 2,
        opacity: 0.1,
        transition: 'opacity 0.2s'
      },
      animated,
      markerEnd: {
        type: MarkerType.Arrow,
        color: edgeColor,
        width: 20,
        height: 20
      }
    };
  }, []);

  const setupGraph = useCallback(async () => {
    if (!contracts || !roles || !roleAssignments || layouting) return;

    setLayouting(true);
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Group contracts by type
    const kernelContract = contracts.find((c) => c.type === "kernel");
    const moduleContracts = contracts.filter((c) => c.type === "module");
    const policyContracts = contracts.filter((c) => c.type === "policy");

    // Add kernel node
    if (kernelContract) {
      newNodes.push({
        ...createNodeFromContract(kernelContract, kernelContract.address),
        position: { x: 0, y: 0 }
      });
    }

    // Add module nodes
    moduleContracts.forEach((contract) => {
      newNodes.push({
        ...createNodeFromContract(contract, contract.address),
        position: { x: 0, y: 0 }
      });
    });

    // Add policy nodes
    policyContracts.forEach((policy) => {
      newNodes.push({
        ...createNodeFromContract(policy, policy.address),
        position: { x: 0, y: 0 }
      });
    });

    // Process roles and assignees
    roles.forEach((role) => {
      const roleId = `role-${role.role}`;
      const roleAssignmentsList = roleAssignments.filter(a => a.role === role.role);

      // Add role node
      newNodes.push({
        id: roleId,
        type: "role",
        position: { x: 0, y: 0 },
        data: {
          label: role.role,
          assignees: roleAssignmentsList,
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
            position: { x: 0, y: 0 }
          });

          // Add edge from role to assignee
          newEdges.push(createEdge(assigneeId, roleId, false));
        }
      });

      // Link roles with policies that use them
      const policyContracts = contracts.filter(c => c.type === 'policy' && Array.isArray(c.policyFunctions));
      policyContracts.forEach(policy => {
        // Check if any function in the policy requires this role
        const policyFunctions = policy.policyFunctions as Array<{ roles: string[] }>;
        const hasRole = policyFunctions.some(func => func.roles.includes(role.role));
        if (hasRole) {
          // Add edge from role to policy
          newEdges.push(createEdge(roleId, policy.address, false));
        }
      });
    });

    // Prepare the graph for ELK layout
    const graph = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "mrtree",
        "elk.spacing.nodeNode": "80",
        "elk.padding": "[top=100,left=100,bottom=100,right=100]",
        "elk.direction": "DOWN",
        "elk.spacing.levelLevel": "150",
        "elk.aspectRatio": "2.0",
        "elk.spacing.individual": "50",
        "elk.hierarchyHandling": "INCLUDE_CHILDREN"
      },
      children: newNodes.map((node) => {
        const isAssignee = node.id.startsWith('assignee-');
        const isRole = node.id.startsWith('role-');
        const isPolicy = policyContracts.some(p => p.address === node.id);
        const isKernel = node.id === kernelContract?.address;
        const isModule = moduleContracts.some(m => m.address === node.id);

        // Assign hierarchy level
        const level = isAssignee ? 0 :
                     isRole ? 1 :
                     isPolicy ? 2 :
                     isKernel ? 3 :
                     isModule ? 4 : 0;

        return {
          id: node.id,
          width: 180,
          height: node.type === 'role' ? 80 : 100,
          layoutOptions: {
            "elk.mrtree.level": level.toString(),
            "elk.mrtree.levelDistance": "150"
          }
        };
      }),
      edges: newEdges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
        layoutOptions: {
          "elk.hierarchical": "true"
        }
      }))
    };

    // Calculate layout using ELK
    const layout = await elk.layout(graph);

    // Apply the layout to nodes
    const nodesWithLayout = newNodes.map((node) => {
      const layoutNode = layout.children?.find((n) => n.id === node.id);
      if (layoutNode) {
        return {
          ...node,
          position: { x: layoutNode.x || 0, y: layoutNode.y || 0 },
        };
      }
      return node;
    });

    setNodes(nodesWithLayout);
    setEdges(newEdges);
    setLayouting(false);
    setInitialized(true);
  }, [contracts, roles, roleAssignments, layouting, createNodeFromContract, createEdge, hoveredRole]);

  useEffect(() => {
    if (!initialized && !layouting && contracts && roles && roleAssignments) {
      setupGraph();
    }
  }, [initialized, layouting, contracts, roles, roleAssignments, setupGraph]);

  const isLoading = isLoadingContracts || isLoadingRoles || isLoadingAssignments || layouting;

  // Render tooltip for hovered assignee
  const renderAssigneeTooltip = () => {
    if (!hoveredNode || !hoveredNode.startsWith('assignee-') || !roleAssignments) return null;

    // Extract assignee address from node ID
    const assigneeAddress = hoveredNode.replace('assignee-', '');

    // Find the node data
    const hoveredNodeData = nodes.find(node => node.id === hoveredNode)?.data;
    if (!hoveredNodeData) return null;

    // Find all roles for this assignee
    const assignedRoles = roleAssignments
      .filter(a => a.assignee.toLowerCase() === assigneeAddress.toLowerCase())
      .map(a => a.role);

    // Get assignee name
    const assigneeName = hoveredNodeData.label?.props?.children?.[1]?.props?.children || 'Unknown';

    return (
      <div
        className="fixed bg-white shadow-lg rounded-lg p-4 min-w-[300px] border border-gray-200"
        style={{
          zIndex: 9999,
          top: '20px',
          right: '20px',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-sm">{assigneeName}</h3>
          <span className="text-xs px-2 py-1 bg-pink-100 text-pink-800 rounded-full">Assignee</span>
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
                    <span className="text-purple-600">{role}</span>
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

  if (isLoading && !initialized) {
    return (
      <div className="w-full h-[800px] flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <div className="w-full h-[800px] border border-gray-200 rounded-lg">
      {contracts?.length === 0 ? (
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-lg">No contracts found</div>
        </div>
      ) : (
        <>
          <ReactFlow
            nodes={nodes}
            edges={edges.map(edge => ({
              ...edge,
              style: {
                ...edge.style,
                opacity: hoveredNode ? (edge.source === hoveredNode || edge.target === hoveredNode ? 1 : 0.4) : 0.4
              }
            }))}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.2}
            maxZoom={1.5}
            defaultViewport={{ x: 0, y: 0, zoom: 0.7 }}
            elementsSelectable={true}
            nodesConnectable={false}
            nodesDraggable={true}
            edgesFocusable={true}
            edgesUpdatable={false}
            onNodeMouseEnter={(_, node) => {
              setHoveredNode(node.id);
            }}
            onNodeMouseLeave={() => {
              setHoveredNode(null);
            }}
            onNodeDragStop={(_event, node) => {
              const updatedNodes = nodes.map((n) =>
                n.id === node.id ? { ...n, position: node.position } : n
              );
              setNodes(updatedNodes);
            }}
          >
            <Background />
            <Controls />
          </ReactFlow>
          {renderAssigneeTooltip()}
        </>
      )}
    </div>
  );
}
