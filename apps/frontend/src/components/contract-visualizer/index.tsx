import { useCallback, useEffect } from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Node,
  useEdgesState,
  useNodesState,
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
    const verticalSpacing = 180; // Reduced from 250 for more compact rows
    const horizontalSpacing = 180; // Reduced from 220 for more compact columns

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

    // Add modules in a horizontal line at the bottom
    const totalModuleWidth = moduleContracts.length * horizontalSpacing;
    const moduleStartX = centerX - totalModuleWidth / 2 + horizontalSpacing / 2;

    moduleContracts.forEach((contract, index) => {
      newNodes.push(
        createNodeFromContract(contract, {
          x: moduleStartX + index * horizontalSpacing,
          y: centerY + verticalSpacing,
        })
      );
    });

    // Group policies by similar names
    const groupPolicies = (policies: Contract[]) => {
      const groups: { [key: string]: Contract[] } = {};

      policies.forEach(policy => {
        // Extract base name by removing version numbers and common suffixes
        const baseName = policy.name
          .replace(/[vV]?\d+(\.\d+)*$/, '') // Remove version numbers at the end
          .replace(/[-_]?v\d+(\.\d+)*/, '') // Remove version numbers with v prefix
          .trim();

        if (!groups[baseName]) {
          groups[baseName] = [];
        }
        groups[baseName].push(policy);
      });

      return Object.values(groups);
    };

    const policyGroups = groupPolicies(policyContracts);
    const maxNodesPerRow = Math.floor(1600 / horizontalSpacing);

    policyGroups.forEach((group, groupIndex) => {
      const row = Math.floor(groupIndex / 4);
      const groupPositionInRow = groupIndex % 4;

      // Calculate group center position
      const groupCenterX = centerX - 450 + (groupPositionInRow * 300);
      const groupY = centerY - verticalSpacing * (2 + row);

      // Position policies within group vertically
      group.forEach((contract, indexInGroup) => {
        // Stack policies vertically within their group
        const verticalOffset = indexInGroup * 80; // Consistent vertical spacing between related policies
        newNodes.push(
          createNodeFromContract(contract, {
            x: groupCenterX,
            y: groupY + verticalOffset,
          })
        );
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
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
