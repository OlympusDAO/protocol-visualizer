import { useCallback, useEffect } from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Node,
  useEdgesState,
  useNodesState,
  NodeTypes,
} from "reactflow";
import "reactflow/dist/style.css";
import { usePonderQuery } from "@ponder/react";
import { schema } from "@/lib/ponder";
import { Contract } from "@/services/contracts";
import { eq } from "@ponder/client";

// Helper functions
const shortenAddress = (address: string) => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const getEtherscanLink = (address: string) => {
  return `https://etherscan.io/address/${address}`;
};

// Policy category mapping
const POLICY_CATEGORIES: Record<string, string> = {
  'Clearinghouse': 'Lending',
  'LoanConsolidator': 'Lending',
  'YieldRepurchase': 'Supply/Demand',
  'Emission': 'Supply/Demand',
  'Bond': 'Supply/Demand',
  'BLVault': 'BLV',
};

// Get category for a policy name
const getPolicyCategory = (policyName: string): string => {
  const matchingCategory = Object.entries(POLICY_CATEGORIES).find(([key]) =>
    policyName.includes(key)
  );
  return matchingCategory ? matchingCategory[1] : 'Other';
};

// Node types configuration
const nodeTypes: NodeTypes = {
  group: () => (
    <div style={{ background: 'transparent' }} />
  ),
};

// TODOs
// [ ] Display last update, etc on hover over a node
// [ ] Click on a policy node to show the policy permissions
// [ ] Click on a module node to show policy permissions that are using that module

export function ContractVisualizer() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const { data: contracts, isLoading } = usePonderQuery({
    queryFn: (db) =>
      db
        .select()
        .from(schema.contract)
        .where(eq(schema.contract.isEnabled, true)),
  });

  const createNodeFromContract = useCallback(
    (contract: Contract, position: { x: number; y: number }) => {
      return {
        id: contract.address,
        position,
        data: {
          label: (
            <div className="p-1 text-sm">
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
        },
      };
    },
    []
  );

  const createEdgesFromPolicyPermissions = useCallback((contract: Contract) => {
    if (contract.type !== "policy" || !contract.policyPermissions) return [];

    return (
      contract.policyPermissions as Array<{ keycode: string; function: string }>
    ).map((permission) => ({
      id: `${contract.address}-${permission.keycode}`,
      source: contract.address,
      target: permission.keycode,
      animated: true,
      label: permission.function,
      style: { stroke: "#666" },
      labelStyle: { fill: "#666", fontSize: 12 },
    }));
  }, []);

  useEffect(() => {
    if (!contracts) return;

    // Group contracts by type
    const kernelContract = contracts.find((c) => c.type === "kernel");
    const moduleContracts = contracts.filter((c) => c.type === "module");
    const policyContracts = contracts.filter((c) => c.type === "policy");

    // Position calculation
    const centerX = 800;
    const centerY = 400;
    const verticalSpacing = 180;
    const horizontalSpacing = 180;
    const nodeWidth = 200; // Width of a single node
    const nodeHeight = 100; // Approximate height of a node
    const nodePadding = 20; // Padding between nodes
    const innerPadding = 40; // Padding inside groups
    const padding = 40; // Padding for group backgrounds

    const newNodes: Node[] = [];

    // Add kernel at center
    if (kernelContract) {
      newNodes.push(
        createNodeFromContract(kernelContract, {
          x: centerX,
          y: centerY,
        })
      );
    }

    // Add modules section at the bottom
    const totalModuleWidth = moduleContracts.length * horizontalSpacing;
    const moduleStartX = centerX - totalModuleWidth / 2 + horizontalSpacing / 2;
    const moduleY = centerY + verticalSpacing * 2; // Move modules further down

    // Add the modules label node
    newNodes.push({
      id: 'modules-label',
      position: {
        x: moduleStartX - padding,
        y: moduleY - padding - 30,
      },
      data: {
        label: (
          <div className="font-bold text-lg text-gray-700">
            Modules
          </div>
        ),
      },
      style: {
        width: 'auto',
        background: 'transparent',
        border: 'none',
      },
    });

    // Add the modules group background
    const groupWidth = Math.max(totalModuleWidth + padding * 2, 200);
    const groupHeight = 160;

    newNodes.push({
      id: 'modules-group',
      position: {
        x: moduleStartX - padding,
        y: moduleY - padding,
      },
      style: {
        width: groupWidth,
        height: groupHeight,
        backgroundColor: 'rgba(240, 245, 255, 0.5)',
        border: '2px dashed #666',
        borderRadius: '12px',
        zIndex: -1,
      },
      data: { label: '' },
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
    const policiesByCategory = policyContracts.reduce((acc, policy) => {
      const category = getPolicyCategory(policy.name);
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(policy);
      return acc;
    }, {} as Record<string, Contract[]>);

    // Calculate policy category positions
    const categories = Object.keys(policiesByCategory).sort((a, b) => {
      // Sort alphabetically but keep "Other" in the sequence
      return a.localeCompare(b);
    });

    // Layout configuration
    const maxCategoriesPerRow = 3;
    const categorySpacing = {
      horizontal: 450, // Increased for more space between categories
      vertical: 350,   // Spacing between rows of categories
    };

    // Calculate total rows needed for all categories
    const totalRows = Math.ceil(categories.length / maxCategoriesPerRow);

    // Start Y position (move up based on number of rows)
    const startY = centerY - (totalRows * categorySpacing.vertical);

    // Add policy nodes by category
    categories.forEach((category, categoryIndex) => {
      const policies = policiesByCategory[category];

      // Calculate category position in the grid
      const row = Math.floor(categoryIndex / maxCategoriesPerRow);
      const col = categoryIndex % maxCategoriesPerRow;

      const categoryX = centerX + (col - 1) * categorySpacing.horizontal;
      const categoryY = startY + (row * categorySpacing.vertical);

      // For "Other" category, just add nodes without group visuals
      if (category === 'Other') {
        // Add nodes in a grid layout
        const nodesPerRow = 2;
        policies.forEach((policy, policyIndex) => {
          const row = Math.floor(policyIndex / nodesPerRow);
          const col = policyIndex % nodesPerRow;
          newNodes.push({
            ...createNodeFromContract(policy, {
              x: categoryX - nodeWidth + col * (nodeWidth + nodePadding),
              y: categoryY + row * (nodeHeight + nodePadding),
            }),
            zIndex: 1,
          });
        });
        return;
      }

      // Add category label
      newNodes.push({
        id: `category-${category}`,
        position: {
          x: categoryX - nodeWidth / 2,
          y: categoryY - 40,
        },
        data: {
          label: (
            <div className="font-bold text-lg text-gray-700">
              {category}
            </div>
          ),
        },
        style: {
          width: 'auto',
          background: 'transparent',
          border: 'none',
        },
      });

      // Calculate grid layout for nodes within the category
      const nodesPerRow = 2;
      const rows = Math.ceil(policies.length / nodesPerRow);
      const categoryWidth = Math.max(nodesPerRow * (nodeWidth + nodePadding) + innerPadding * 2, 240);
      const categoryHeight = Math.max(rows * (nodeHeight + nodePadding) + innerPadding * 2, 120);

      // Add category background
      newNodes.push({
        id: `category-bg-${category}`,
        position: {
          x: categoryX - categoryWidth / 2,
          y: categoryY,
        },
        style: {
          width: categoryWidth,
          height: categoryHeight,
          backgroundColor: 'rgba(245, 240, 255, 0.5)',
          border: '2px dashed #666',
          borderRadius: '12px',
          zIndex: -1,
        },
        data: { label: '' },
      });

      // Add policy nodes in a grid layout
      policies.forEach((policy, policyIndex) => {
        const row = Math.floor(policyIndex / nodesPerRow);
        const col = policyIndex % nodesPerRow;

        newNodes.push({
          ...createNodeFromContract(policy, {
            x: categoryX - (categoryWidth / 2) + innerPadding + col * (nodeWidth + nodePadding),
            y: categoryY + innerPadding + row * (nodeHeight + nodePadding),
          }),
          zIndex: 1,
        });
      });
    });

    // Create edges
    const newEdges: Edge[] = contracts.flatMap(createEdgesFromPolicyPermissions);

    setNodes(newNodes);
    setEdges(newEdges);
  }, [
    contracts,
    createNodeFromContract,
    createEdgesFromPolicyPermissions,
    setNodes,
    setEdges,
  ]);

  if (isLoading) {
    return (
      <div className="w-full h-[800px] flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <div className="w-full h-[800px] border border-gray-200 rounded-lg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
