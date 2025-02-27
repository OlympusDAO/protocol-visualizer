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
            id="assignee-target"
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
            id="assignee-source"
            type="source"
            position={Position.Right}
            style={{
              background: NODE_COLORS.assignee.border,
              border: `1px solid ${NODE_COLORS.assignee.border}`,
            }}
          />
        </div>
      ),
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
const RoleTooltip = ({ role, assignments }: { role: string; assignments: RoleAssignment[] }) => {
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
      <h3 className="font-bold text-sm mb-2">{role}</h3>
      <div className="text-sm">
        <div className="font-semibold mb-1">Active Assignees:</div>
        <ul className="list-disc pl-4">
          {assignments.map((assignment, index) => (
            <li key={index} className="text-xs mb-1">
              <span className="text-purple-600">{assignment.assigneeName}</span>
              <a
                href={getEtherscanLink(assignment.assignee)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-700 ml-1"
              >
                ({shortenAddress(assignment.assignee)})
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

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
// [ ] Click on a policy node to show the policy permissions
// [ ] Click on a module node to show policy permissions that are using that module

export function ContractVisualizer() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [hoveredPolicy, setHoveredPolicy] = useState<string | null>(null);
  const [hoveredRole, setHoveredRole] = useState<string | null>(null);
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
  const createEdge = useCallback((source: string, target: string, animated: boolean = false) => ({
    id: `${source}-${target}`,
    source,
    target,
    sourceHandle: `${source}-source`,
    targetHandle: `${target}-target`,
    type: "smoothstep",
    style: { stroke: "#9333ea", strokeWidth: 2 },
    animated,
    markerEnd: {
      type: MarkerType.Arrow,
      color: '#9333ea',
      width: 20,
      height: 20
    }
  }), []);

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
          newEdges.push(createEdge(assignment.assignee, roleId, true));
        } else {
          // Create node for non-contract assignee
          const assigneeId = `assignee-${assignment.assignee}`;
          newNodes.push({
            ...createAssigneeNode(assignment, assigneeId),
            position: { x: 0, y: 0 }
          });

          // Add edge from role to assignee
          newEdges.push(createEdge(assigneeId, roleId));
        }
      });
    });

    // Prepare the graph for ELK layout
    const graph = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "force",
        "elk.force.iterations": "300",
        "elk.force.repulsion": "2.0",
        "elk.force.attraction": "0.1",
        "elk.spacing.nodeNode": "100",
        "elk.padding": "[top=50,left=50,bottom=50,right=50]",
        "elk.randomSeed": "1"
      },
      children: newNodes.map((node) => ({
        id: node.id,
        width: 180,
        height: node.type === 'role' ? 80 : 100
      })),
      edges: newEdges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target]
      })),
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
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.1}
          maxZoom={2}
          defaultViewport={{ x: 0, y: 0, zoom: 0.5 }}
          elementsSelectable={true}
          nodesConnectable={false}
          nodesDraggable={true}
          edgesFocusable={true}
          edgesUpdatable={false}
          onNodeDragStop={(event, node) => {
            // Update the node's position in our state
            const updatedNodes = nodes.map((n) =>
              n.id === node.id ? { ...n, position: node.position } : n
            );
            setNodes(updatedNodes);
          }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      )}
    </div>
  );
}
