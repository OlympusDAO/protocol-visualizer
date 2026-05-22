import type { EvmOnEventContext } from "envio";
import type { Address, Hex } from "viem";

export type EntityStore = {
  get: <T>(id: string) => Promise<T | undefined>;
  set: (entity: Record<string, unknown>) => void;
};

export type EnvioContext = EvmOnEventContext & {
  ActionExecutedEvent: EntityStore;
  Contract: EntityStore;
  ContractEvent: EntityStore;
  CurrentModule: EntityStore;
  CurrentRoleAssignee: EntityStore;
  KernelExecutor: EntityStore;
  KernelExecutorEvent: EntityStore;
  Role: EntityStore;
  RoleAssignment: EntityStore;
  RoleEvent: EntityStore;
};

export type RequestedPolicyPermission = {
  keycode: Hex;
  funcSelector: Hex;
};

export type RequestedPolicyPermissionsResult = {
  permissions: RequestedPolicyPermission[];
  usedLatestFallback: boolean;
};

export type PolicyPermission = {
  keycode: string;
  function: string;
};

export type BaseEvent = {
  chainId: number;
  block: { number: number; timestamp: number };
  transaction: { hash: string };
  logIndex: number;
  srcAddress: Address;
};

export type KernelActionExecutedEvent = BaseEvent & {
  params: { action_: bigint; target_: Address };
};

export type RoleGrantedEvent = BaseEvent & {
  params: { role_: Hex; addr_: Address };
};

export type RoleRevokedEvent = BaseEvent & {
  params: { role_: Hex; addr_: Address };
};

export type NewAdminPulledEvent = BaseEvent & {
  params: { newAdmin_: Address };
};

export type ContractType = "KERNEL" | "MODULE" | "POLICY";

export type ActionType =
  | "installModule"
  | "upgradeModule"
  | "activatePolicy"
  | "deactivatePolicy"
  | "changeExecutor"
  | "migrateKernel";

export type ContractEntity = {
  id: string;
  chainId: number;
  address: string;
  lastUpdatedTimestamp: bigint;
  lastUpdatedBlockNumber: bigint;
  name: string;
  version?: string;
  contractType: ContractType;
  isEnabled: boolean;
  policyPermissions?: unknown;
  policyFunctions?: unknown;
};

export type CurrentModuleEntity = {
  id: string;
  chainId: number;
  keycode: string;
  address: string;
  lastUpdatedTimestamp: bigint;
  lastUpdatedBlockNumber: bigint;
};

export type CurrentRoleAssigneeEntity = {
  id: string;
  chainId: number;
  role: string;
  assignee: string;
  assigneeName: string;
  lastUpdatedTimestamp: bigint;
  lastUpdatedBlockNumber: bigint;
};
