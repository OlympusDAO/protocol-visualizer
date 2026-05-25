type ContractType = "kernel" | "module" | "policy";
type EnvioContractType = "KERNEL" | "MODULE" | "POLICY";

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

export type ProtocolVisualizerData = {
  contracts: Contract[];
  roles: Role[];
  roleAssignments: RoleAssignment[];
};

type ProtocolSnapshot = {
  schemaVersion: "1.0.0";
  generatedAt: string;
  chainId: number;
  recordCounts: {
    contracts: number;
    roles: number;
    roleAssignments: number;
  };
  data: ProtocolVisualizerData;
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
    `${baseUrl}/v1/chain/${chainId}/protocol.json`,
    window.location.origin
  );

  const response = await fetch(url, {
    method: "GET",
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
  return snapshot.data;
}

export async function getContracts(chainId: number): Promise<Contract[]> {
  return (await getProtocolVisualizerData(chainId)).contracts;
}
