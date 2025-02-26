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

    // Add modules section
    const totalModuleWidth = moduleContracts.length * horizontalSpacing;
    const moduleStartX = centerX - totalModuleWidth / 2 + horizontalSpacing / 2;
    const moduleY = centerY + verticalSpacing;

    // Create a group node for modules
    const padding = 40;
    const groupWidth = Math.max(totalModuleWidth + padding * 2, 200);
    const groupHeight = 160;

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

    // Add the group background
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

    // Add policy nodes
    const groupPolicies = (policies: Contract[]) => {
      const groups: { [key: string]: Contract[] } = {};

      policies.forEach(policy => {
        const baseName = policy.name
          .replace(/[vV]?\d+(\.\d+)*$/, '')
          .replace(/[-_]?v\d+(\.\d+)*/, '')
          .trim();

        if (!groups[baseName]) {
          groups[baseName] = [];
        }
        groups[baseName].push(policy);
      });

      return Object.values(groups);
    };

    const policyGroups = groupPolicies(policyContracts);

    policyGroups.forEach((group, groupIndex) => {
      const row = Math.floor(groupIndex / 4);
      const groupPositionInRow = groupIndex % 4;
      const groupCenterX = centerX - 450 + (groupPositionInRow * 300);
      const groupY = centerY - verticalSpacing * (2 + row);

      group.forEach((contract, indexInGroup) => {
        const verticalOffset = indexInGroup * 80;
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
        nodeTypes={nodeTypes}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
