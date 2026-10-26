import {
  readSnapshotData,
  type SnapshotExtension,
  type SnapshotSchemaVersion,
  type AdditionalContract,
  type FunctionContext,
} from "../../../../packages/snapshot-artifacts/src/index";
import otherContracts from "../../../../packages/protocol-config/other-contracts.json";

type ContractType = "kernel" | "module" | "policy";
type EnvioContractType = "KERNEL" | "MODULE" | "POLICY";

export type PolicyFunction = {
  name: string;
  roles: string[];
  signature?: string;
  canonicalSignature?: string;
  documentation?: FunctionContext;
};
export type PolicyPermission = {
  keycode: string;
  function: string;
  functionContext?: FunctionContext;
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Contract = {
  id: string;
  chainId: number;
  address: string;
  lastUpdatedTimestamp: string;
  lastUpdatedBlockNumber: string;
  name: string;
  version?: string | null;
  contractType: EnvioContractType;
  type: ContractType;
  isEnabled: boolean;
  policyPermissions?: JsonValue;
  policyFunctions?: JsonValue;
};

export type Role = {
  id: string;
  chainId: number;
  role: string;
};

export type RoleAssignment = {
  id: string;
  chainId: number;
  role: string;
  assignee: string;
  assigneeName: string;
  lastUpdatedTimestamp: string;
  lastUpdatedBlockNumber: string;
  isGranted: boolean;
};

export type ProtocolVisualizerData = Required<SnapshotExtension> & {
  contracts: Contract[];
  roles: Role[];
  roleAssignments: RoleAssignment[];
};

type ProtocolSnapshot = {
  schemaVersion: SnapshotSchemaVersion;
  generatedAt: string;
  chainId: number;
  recordCounts: {
    contracts: number;
    roles: number;
    roleAssignments: number;
  };
  data: Omit<ProtocolVisualizerData, keyof SnapshotExtension> &
    SnapshotExtension;
};

const DEFAULT_PROTOCOL_SNAPSHOT_BASE_URL = "http://localhost:8082";

function getProtocolSnapshotBaseUrl(): string {
  const url = import.meta.env.VITE_PROTOCOL_SNAPSHOT_BASE_URL;
  if (!url && import.meta.env.PROD) {
    throw new Error("VITE_PROTOCOL_SNAPSHOT_BASE_URL is not set");
  }

  return url || DEFAULT_PROTOCOL_SNAPSHOT_BASE_URL;
}

async function protocolSnapshotRequest(
  chainId: number
): Promise<ProtocolSnapshot> {
  const baseUrl = getProtocolSnapshotBaseUrl().replace(/\/+$/, "");
  const url = new URL(
    `${baseUrl}/v1/chains/${chainId}/protocol`,
    window.location.origin
  );

  const response = await fetch(url, {
    method: "GET",
    cache: "no-cache",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Protocol snapshot request failed with HTTP ${response.status}`
    );
  }

  const payload = (await response.json()) as ProtocolSnapshot;

  return payload;
}

export async function getProtocolVisualizerData(
  chainId: number
): Promise<ProtocolVisualizerData> {
  const snapshot = await protocolSnapshotRequest(chainId);
  return decodeProtocolSnapshot(snapshot);
}

export function decodeProtocolSnapshot(
  snapshot: ProtocolSnapshot
): ProtocolVisualizerData {
  const data = readSnapshotData(snapshot);
  const resolveName = (address: string, name: string) =>
    name === "UNKNOWN"
      ? (otherContracts.find(
          (entry) =>
            entry.chainId === snapshot.chainId &&
            entry.address === address.toLowerCase()
        )?.name ?? name)
      : name;
  return {
    ...data,
    contracts: data.contracts.map((contract) => ({
      ...contract,
      address: contract.address.toLowerCase(),
      name: resolveName(contract.address, contract.name),
      // Legacy snapshots append return types after the input signature.
      policyPermissions:
        (contract.policyPermissions as PolicyPermission[] | null)?.map(
          (permission) => ({
            ...permission,
            function: permission.function?.replace(/\)\(.*$/, ")"),
          })
        ) ?? contract.policyPermissions,
    })),
    additionalContracts: data.additionalContracts.map((contract) => ({
      ...contract,
      name: resolveName(contract.address, contract.name),
    })),
    roleAssignments: data.roleAssignments.map((assignment) => ({
      ...assignment,
      assignee: assignment.assignee.toLowerCase(),
      assigneeName: resolveName(assignment.assignee, assignment.assigneeName),
    })),
  };
}

export function getAdditionalGraphContracts(
  data: ProtocolVisualizerData
): AdditionalContract[] {
  const existing = new Set(
    data.contracts.map(
      (contract) => `${contract.chainId}:${contract.address.toLowerCase()}`
    )
  );
  const unique = new Map<string, AdditionalContract>();
  for (const contract of data.additionalContracts) {
    const id = `${contract.chainId}:${contract.address.toLowerCase()}`;
    if (!existing.has(id))
      unique.set(id, {
        ...contract,
        id,
        address: contract.address.toLowerCase(),
      });
  }
  return [...unique.values()];
}

export async function getContracts(chainId: number): Promise<Contract[]> {
  return (await getProtocolVisualizerData(chainId)).contracts;
}
