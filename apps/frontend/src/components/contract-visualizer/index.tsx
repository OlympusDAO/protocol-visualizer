'use client';

import { useCallback, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Node,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { usePonderQuery } from '@ponder/react';
import { schema } from '@/lib/ponder';
import { Contract } from '@/services/contracts';

export function ContractVisualizer() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const { data: contracts, isLoading } = usePonderQuery({
    queryFn: (db) => db.select().from(schema.contract),
  })

  const createNodeFromContract = useCallback((contract: Contract, position: { x: number; y: number }) => {
    return {
      id: contract.address,
      position,
      data: {
        label: (
          <div className="p-2 text-sm">
            <div className="font-bold">{contract.type.toUpperCase()}</div>
            <div className="text-xs break-all">{contract.address}</div>
            {contract.moduleKeycode && (
              <div className="text-xs mt-1">Keycode: {contract.moduleKeycode}</div>
            )}
            {!contract.isEnabled && (
              <div className="text-xs mt-1 text-red-500">Disabled</div>
            )}
          </div>
        ),
      },
      style: {
        background: contract.isEnabled ? '#fff' : '#f0f0f0',
        border: '1px solid #ccc',
        borderRadius: '8px',
        padding: '10px',
        opacity: contract.isEnabled ? 1 : 0.7,
      },
    };
  }, []);

  const createEdgesFromPolicyPermissions = useCallback((contract: Contract) => {
    if (contract.type !== 'policy' || !contract.policyPermissions) return [];

    return (contract.policyPermissions as Array<{ keycode: string; function: string }>).map((permission) => ({
      id: `${contract.address}-${permission.keycode}`,
      source: contract.address,
      target: permission.keycode,
      animated: true,
      label: permission.function,
      style: { stroke: '#666' },
      labelStyle: { fill: '#666', fontSize: 12 },
    }));
  }, []);

  useEffect(() => {
    if (!contracts) return;

    // Group contracts by type
    const kernelContract = contracts.find((c) => c.type === 'kernel');
    const moduleContracts = contracts.filter((c) => c.type === 'module');
    const policyContracts = contracts.filter((c) => c.type === 'policy');

    // Position calculation
    const centerX = 400;
    const centerY = 400;
    const radius = 200;

    // Create nodes
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

    // Add modules in a circle around the kernel
    moduleContracts.forEach((contract, index) => {
      const angle = (index * 2 * Math.PI) / moduleContracts.length;
      newNodes.push(
        createNodeFromContract(contract, {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        })
      );
    });

    // Add policies in a larger circle
    policyContracts.forEach((contract, index) => {
      const angle = (index * 2 * Math.PI) / policyContracts.length;
      newNodes.push(
        createNodeFromContract(contract, {
          x: centerX + (radius * 1.5) * Math.cos(angle),
          y: centerY + (radius * 1.5) * Math.sin(angle),
        })
      );
    });

    // Create edges
    const newEdges: Edge[] = contracts.flatMap(createEdgesFromPolicyPermissions);

    setNodes(newNodes);
    setEdges(newEdges);
  }, [contracts, createNodeFromContract, createEdgesFromPolicyPermissions, setNodes, setEdges]);

  if (isLoading) {
    return <div className="w-full h-[800px] flex items-center justify-center">Loading...</div>;
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