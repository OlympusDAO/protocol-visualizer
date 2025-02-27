import { useCallback, useEffect, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  Node,
  useEdgesState,
  useNodesState,
  NodeTypes,
  Edge,
} from "reactflow";
import "reactflow/dist/style.css";
import { usePonderQuery } from "@ponder/react";
import { schema } from "@/lib/ponder";
import { Contract } from "@/services/contracts";
import { eq } from "@ponder/client";

// Types
type Role = typeof schema.role.$inferSelect;
type RoleAssignment = typeof schema.roleAssignment.$inferSelect;

// Helper functions
const shortenAddress = (address: string) => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const getEtherscanLink = (address: string) => {
  return `https://etherscan.io/address/${address}`;
};

// Policy category mapping
const POLICY_CATEGORIES: Record<string, string> = {
  Clearinghouse: "Lending",
  LoanConsolidator: "Lending",
  YieldRepurchase: "Supply/Demand",
  Emission: "Supply/Demand",
  Bond: "Supply/Demand",
  BLVault: "BLV",
};

// Get category for a policy name
const getPolicyCategory = (policyName: string): string => {
  const matchingCategory = Object.entries(POLICY_CATEGORIES).find(([key]) =>
    policyName.includes(key)
  );
  return matchingCategory ? matchingCategory[1] : "Other";
};

// Create a node for a non-contract assignee
const createAssigneeNode = (
  assignee: RoleAssignment,
  position: { x: number; y: number }
) => {
  return {
    id: `assignee-${assignee.assignee}`,
    position,
    data: {
      label: (
        <div className="p-1 text-sm">
          <div className="font-bold mb-1 break-words whitespace-pre-wrap max-w-[160px]">
            {assignee.assigneeName === "UNKNOWN" ? "EOA" : assignee.assigneeName}
          </div>
          <a
            href={getEtherscanLink(assignee.assignee)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs break-all text-blue-500 hover:text-blue-700"
          >
            {shortenAddress(assignee.assignee)}
          </a>
        </div>
      ),
    },
    style: {
      background: "#fff",
      border: "1px solid #ccc",
      borderRadius: "8px",
      padding: "6px",
      minWidth: "180px",
    },
  };
};

// Node types configuration
const nodeTypes: NodeTypes = {
  group: () => <div style={{ background: "transparent" }} />,
  role: ({ data }) => (
    <div
      className="bg-purple-50 border border-purple-200 rounded-lg p-4 cursor-pointer hover:bg-purple-100 transition-colors"
      onMouseEnter={() => data.onMouseEnter?.()}
      onMouseLeave={() => data.onMouseLeave?.()}
    >
      <div className="font-bold text-purple-700 mb-2">{data.label}</div>
      {data.assignees && (
        <div className="text-xs text-purple-600">
          {data.assignees.length} Active Assignee(s)
        </div>
      )}
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
    (contract: Contract, position: { x: number; y: number }) => {
      const isPolicyType = contract.type === "policy";

      return {
        id: contract.address,
        position,
        data: {
          label: (
            <div
              className="p-1 text-sm"
              style={{ position: "relative" }}
              onMouseEnter={() =>
                isPolicyType && setHoveredPolicy(contract.address)
              }
              onMouseLeave={() => isPolicyType && setHoveredPolicy(null)}
            >
              <div className="font-bold mb-1 break-words whitespace-pre-wrap max-w-[160px]">
                {contract.name}
              </div>
              <a
                href={getEtherscanLink(contract.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs break-all text-blue-500 hover:text-blue-700"
              >
                {shortenAddress(contract.address)}
              </a>
              {!contract.isEnabled && (
                <div className="text-xs mt-1 text-red-500">Disabled</div>
              )}
              {isPolicyType && hoveredPolicy === contract.address && (
                <PolicyTooltip contract={contract} />
              )}
            </div>
          ),
        },
        style: {
          background: contract.isEnabled ? "#fff" : "#f0f0f0",
          border: "1px solid #ccc",
          borderRadius: "8px",
          padding: "6px",
          opacity: contract.isEnabled ? 1 : 0.7,
          minWidth: "180px",
          zIndex: hoveredPolicy === contract.address ? 1000 : 1,
        },
      };
    },
    [hoveredPolicy, setHoveredPolicy]
  );

  useEffect(() => {
    if (!contracts || !roles || !roleAssignments) return;

    // Group contracts by type
    const kernelContract = contracts.find((c) => c.type === "kernel");
    const moduleContracts = contracts.filter((c) => c.type === "module");
    const policyContracts = contracts.filter((c) => c.type === "policy");

    // Position calculation
    const centerX = window.innerWidth / 2; // Make it responsive
    const centerY = 400;
    const verticalSpacing = 180;
    const horizontalSpacing = 180;
    const nodeWidth = 180; // Slightly reduced node width to ensure better fit
    const nodeHeight = 100; // Approximate height of a node
    const nodePadding = 20; // Padding between nodes
    const innerPadding = 40; // Padding inside groups
    const padding = 40; // Padding for group backgrounds

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Add kernel at center
    if (kernelContract) {
      newNodes.push(
        createNodeFromContract(kernelContract, {
          x: centerX - 100,
          y: centerY,
        })
      );
    }

    // Add modules section at the bottom
    const totalModuleWidth = moduleContracts.length * horizontalSpacing;
    const moduleStartX = centerX - totalModuleWidth / 2;
    const moduleY = centerY + verticalSpacing;

    // Add the modules label node
    newNodes.push({
      id: "modules-label",
      position: {
        x: centerX - 50,
        y: moduleY - padding - 40,
      },
      data: {
        label: <div className="font-bold text-lg text-gray-700">Modules</div>,
      },
      style: {
        width: "auto",
        background: "transparent",
        border: "none",
      },
    });

    // Add the modules group background
    const groupWidth = Math.max(totalModuleWidth + padding * 2, 200);
    const groupHeight = 160;

    newNodes.push({
      id: "modules-group",
      position: {
        x: moduleStartX - padding,
        y: moduleY - padding,
      },
      style: {
        width: groupWidth,
        height: groupHeight,
        backgroundColor: "rgba(240, 245, 255, 0.5)",
        border: "2px dashed #666",
        borderRadius: "12px",
        zIndex: -1,
      },
      data: { label: "" },
    });

    // Add module nodes
    moduleContracts.forEach((contract, index) => {
      newNodes.push({
        ...createNodeFromContract(contract, {
          x: moduleStartX + index * horizontalSpacing,
          y: moduleY,
        }),
        zIndex: 1,
      });
    });

    // Group policies by category
    const policiesByCategory = policyContracts.reduce(
      (acc, policy) => {
        const category = getPolicyCategory(policy.name);
        if (!acc[category]) {
          acc[category] = [];
        }
        acc[category].push(policy);
        return acc;
      },
      {} as Record<string, Contract[]>
    );

    // Calculate policy category positions
    const categories = Object.keys(policiesByCategory).sort((a, b) => {
      return a.localeCompare(b);
    });

    // Layout configuration
    const maxCategoriesPerRow = 3;
    const categorySpacing = {
      horizontal: 650,
      vertical: 350,
    };

    const totalRows = Math.ceil(categories.length / maxCategoriesPerRow);
    const startY = centerY - totalRows * categorySpacing.vertical;

    // Add policy nodes by category
    categories.forEach((category, categoryIndex) => {
      const policies = policiesByCategory[category];
      const row = Math.floor(categoryIndex / maxCategoriesPerRow);
      const col = categoryIndex % maxCategoriesPerRow;
      const nodesPerRow = 2;
      const rows = Math.ceil(policies.length / nodesPerRow);
      const contentWidth =
        nodesPerRow * nodeWidth + (nodesPerRow - 1) * nodePadding;
      const categoryWidth = contentWidth + innerPadding * 2;
      const categoryHeight = Math.max(
        rows * (nodeHeight + nodePadding) + innerPadding * 2,
        120
      );
      const colOffset = col - Math.floor(maxCategoriesPerRow / 2);
      const categoryX =
        centerX - categoryWidth / 2 + colOffset * categorySpacing.horizontal;
      const categoryY = startY + row * categorySpacing.vertical;

      // Add category label
      newNodes.push({
        id: `category-${category}`,
        position: {
          x: categoryX + categoryWidth / 2 - 50,
          y: categoryY - 40,
        },
        data: {
          label: (
            <div className="font-bold text-lg text-gray-700">{category}</div>
          ),
        },
        style: {
          width: "100px",
          textAlign: "center" as const,
          background: "transparent",
          border: "none",
        },
      });

      // Add category background
      newNodes.push({
        id: `category-bg-${category}`,
        position: {
          x: categoryX,
          y: categoryY,
        },
        style: {
          width: categoryWidth,
          height: categoryHeight,
          backgroundColor: "rgba(245, 240, 255, 0.5)",
          border: "2px dashed #666",
          borderRadius: "12px",
          zIndex: -1,
        },
        data: { label: "" },
      });

      // Add policy nodes
      policies.forEach((policy, policyIndex) => {
        const row = Math.floor(policyIndex / nodesPerRow);
        const col = policyIndex % nodesPerRow;
        const xPosition =
          categoryX + innerPadding + col * (nodeWidth + nodePadding);

        newNodes.push({
          ...createNodeFromContract(policy, {
            x: xPosition,
            y: categoryY + innerPadding + row * (nodeHeight + nodePadding),
          }),
          zIndex: 1,
        });
      });
    });

    // Add roles section on the right
    const rolesX = centerX + Math.max(totalModuleWidth, groupWidth) / 2 + horizontalSpacing;
    const rolesY = startY;
    const rolesPerColumn = 4;
    const totalRolesHeight = Math.min(roles.length, rolesPerColumn) * (nodeHeight + nodePadding);

    // Add roles label
    newNodes.push({
      id: "roles-label",
      position: {
        x: rolesX + 50,
        y: rolesY - padding - 40,
      },
      data: {
        label: <div className="font-bold text-lg text-gray-700">Roles</div>,
      },
      style: {
        width: "auto",
        background: "transparent",
        border: "none",
      },
    });

    // Add roles group background
    const rolesGroupWidth = nodeWidth + padding * 2;
    const totalColumns = Math.ceil(roles.length / rolesPerColumn);
    const rolesGroupHeight = rolesPerColumn * (nodeHeight + nodePadding) + padding * 2;

    newNodes.push({
      id: "roles-group",
      position: {
        x: rolesX - padding,
        y: rolesY - padding,
      },
      style: {
        width: rolesGroupWidth * totalColumns + padding * 2,
        height: rolesGroupHeight,
        backgroundColor: "rgba(250, 240, 255, 0.5)",
        border: "2px dashed #666",
        borderRadius: "12px",
        zIndex: -1,
      },
      data: { label: "" },
      type: "group",
    });

    // Group role assignments by role
    const roleAssignmentsByRole = roleAssignments.reduce((acc, assignment) => {
      if (!acc[assignment.role]) {
        acc[assignment.role] = [];
      }
      acc[assignment.role].push(assignment);
      return acc;
    }, {} as Record<string, RoleAssignment[]>);

    // Add role nodes and their assignees
    roles.forEach((role, index) => {
      const column = Math.floor(index / rolesPerColumn);
      const rowInColumn = index % rolesPerColumn;
      const xPosition = rolesX + column * (nodeWidth + horizontalSpacing);
      const yPosition = rolesY + rowInColumn * (nodeHeight + nodePadding);

      const roleAssignmentsList = roleAssignmentsByRole[role.role] || [];

      // Add role node
      newNodes.push({
        id: `role-${role.role}`,
        type: "role",
        position: { x: xPosition, y: yPosition },
        data: {
          label: role.role,
          assignees: roleAssignmentsList,
          onMouseEnter: () => setHoveredRole(role.role),
          onMouseLeave: () => setHoveredRole(null),
        },
        style: {
          zIndex: hoveredRole === role.role ? 1000 : 1,
        },
      });

      if (hoveredRole === role.role) {
        newNodes.push({
          id: `role-tooltip-${role.role}`,
          position: { x: xPosition + nodeWidth + 10, y: yPosition },
          data: {
            label: <RoleTooltip role={role.role} assignments={roleAssignmentsList} />,
          },
          style: {
            background: "transparent",
            border: "none",
            zIndex: 1001,
          },
        });
      }

      // Process assignees
      roleAssignmentsList.forEach((assignment, assigneeIndex) => {
        // Check if this assignee is a contract
        const contractNode = contracts.find(c => c.address.toLowerCase() === assignment.assignee.toLowerCase());

        if (contractNode) {
          // Add edge to existing contract node
          newEdges.push({
            id: `${role.role}-${assignment.assignee}`,
            source: `role-${role.role}`,
            target: assignment.assignee,
            type: "smoothstep",
            style: { stroke: "#9333ea", strokeWidth: 2 },
            animated: true,
          });
        } else {
          // Create node for non-contract assignee
          const assigneeStartX = xPosition + nodeWidth + horizontalSpacing;
          const assigneeY = yPosition + (assigneeIndex * (nodeHeight + nodePadding)) / 2;

          // Add assignee node
          newNodes.push(
            createAssigneeNode(assignment, {
              x: assigneeStartX,
              y: assigneeY,
            })
          );

          // Add edge from role to assignee
          newEdges.push({
            id: `${role.role}-${assignment.assignee}`,
            source: `role-${role.role}`,
            target: `assignee-${assignment.assignee}`,
            type: "smoothstep",
            style: { stroke: "#9333ea", strokeWidth: 2 },
          });
        }
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [contracts, roles, roleAssignments, createNodeFromContract, setNodes, setEdges, hoveredRole, hoveredPolicy]);

  if (isLoadingContracts || isLoadingRoles || isLoadingAssignments) {
    return (
      <div className="w-full h-[800px] flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <div className="w-full h-[800px] border border-gray-200 rounded-lg">
      {isLoadingContracts ? (
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-lg">Loading contracts...</div>
        </div>
      ) : contracts?.length === 0 ? (
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
          nodesDraggable={false}
          edgesFocusable={true}
          edgesUpdatable={false}
        >
          <Background />
          <Controls />
        </ReactFlow>
      )}
    </div>
  );
}
