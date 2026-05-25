export type ContractType = "kernel" | "module" | "policy";
export type EnvioContractType = "KERNEL" | "MODULE" | "POLICY";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ChainConfig = {
  key: string;
  chainId: number;
  name: string;
  explorerBaseUrl: string;
};

export type GraphqlContract = {
  id: unknown;
  chainId: unknown;
  address: unknown;
  lastUpdatedTimestamp: unknown;
  lastUpdatedBlockNumber: unknown;
  name: unknown;
  version?: unknown;
  contractType: EnvioContractType;
  isEnabled: unknown;
  policyPermissions?: JsonValue;
  policyFunctions?: JsonValue;
};

export type GraphqlRole = {
  id: unknown;
  chainId: unknown;
  role: unknown;
};

export type GraphqlRoleAssignment = {
  id: unknown;
  chainId: unknown;
  role: unknown;
  assignee: unknown;
  assigneeName: unknown;
  lastUpdatedTimestamp: unknown;
  lastUpdatedBlockNumber: unknown;
  isGranted: unknown;
};

export type ProtocolGraphqlData = {
  Contract?: GraphqlContract[];
  Role?: GraphqlRole[];
  RoleAssignment?: GraphqlRoleAssignment[];
};

export type Contract = {
  id: string;
  chainId: number;
  address: string;
  lastUpdatedTimestamp: string;
  lastUpdatedBlockNumber: string;
  name: string;
  version: string | null;
  contractType: EnvioContractType;
  type: ContractType;
  isEnabled: boolean;
  policyPermissions: JsonValue;
  policyFunctions: JsonValue;
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

export type RecordCounts = {
  contracts: number;
  roles: number;
  roleAssignments: number;
};

export type ProtocolSnapshot = {
  schemaVersion: "1.0.0";
  generatedAt: string;
  chainId: number;
  recordCounts: RecordCounts;
  data: {
    contracts: Contract[];
    roles: Role[];
    roleAssignments: RoleAssignment[];
  };
};

export type Manifest = {
  schemaVersion: "1.0.0";
  generatedAt: string;
  schemas: {
    manifest: string;
    protocolSnapshot: string;
  };
  chains: Array<{
    chainId: number;
    name: string;
    path: string;
    generatedAt: string;
    recordCounts: RecordCounts;
  }>;
};

export type SnapshotFile = {
  publicPath: string;
  key: string;
  contentType: string;
  cacheControl: string;
  body: string;
  publishLast?: boolean;
};
