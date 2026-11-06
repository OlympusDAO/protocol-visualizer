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
  availability?: "indexed" | "historical";
  environment?: "production" | "testnet";
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
  kernelHistory?: "installed" | "never-installed" | "unknown" | null;
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

export type InventoryContract = {
  chainId: number;
  address: string;
  name: string;
  startBlock?: number;
  labelOnly?: boolean;
};

export type ProtocolGraphqlData = {
  BridgeConfiguration?: BridgeConfiguration[];
  HeartTasks?: HeartTasks[];
  KnownContract?: Pick<
    GraphqlContract,
    | "address"
    | "name"
    | "version"
    | "contractType"
    | "isEnabled"
    | "kernelHistory"
  >[];
  ContractState?: ContractState[];
  ContractRelationship?: (Omit<
    ContractRelationship,
    | "subject"
    | "getter"
    | "coverage"
    | "verification"
    | "functionContext"
    | "targetCode"
  > & {
    subject?: string | null;
    getter?: string | null;
    coverage?: string | null;
    verification?: ContractRelationship["verification"] | null;
    functionContext?: ContractRelationship["functionContext"] | null;
    targetCode?: ContractRelationship["targetCode"] | null;
  })[];
  ChainObservation?: ChainObservation[];
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
  kernelHistory?: "installed" | "never-installed" | "unknown";
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

export type ProtocolSnapshot = {
  schemaVersion: SnapshotSchemaVersion;
  generatedAt: string;
  chainId: number;
  recordCounts: RecordCounts;
  data: SnapshotExtension & {
    contracts: Contract[];
    roles: Role[];
    roleAssignments: RoleAssignment[];
  };
};

export type Manifest = SnapshotManifest;

export type SnapshotBatch = {
  files: SnapshotFile[];
  manifest: Manifest;
  indexingProgress: IndexingProgress;
  ready: boolean;
};

export type SnapshotFile = {
  publicPath: string;
  key: string;
  contentType: string;
  cacheControl: string;
  body: string;
  publishLast?: boolean;
};
import type {
  BridgeConfiguration,
  HeartTasks,
  IndexingProgress,
  ContractState,
  ContractRelationship,
  ChainObservation,
  SnapshotExtension,
  SnapshotSchemaVersion,
  RecordCounts,
  SnapshotManifest,
} from "@protocol-visualizer/snapshot-artifacts";
