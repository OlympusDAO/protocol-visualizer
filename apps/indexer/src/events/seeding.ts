import { getContractName } from "../ContractNames";
import { getKernelConstants, getRolesAdminConstants } from "../constants";
import { ROLE_ROLES_ADMIN } from "../services/contracts/types";
import {
  actionExecutedEventId,
  contractEventId,
  contractId,
  currentRoleAssigneeId,
  kernelExecutorEventId,
  kernelExecutorId,
  roleAssignmentId,
  roleEventId,
  roleId,
} from "./ids";
import type { EnvioContext } from "./types";
import { getKernelExecutor, getRolesAdmin } from "./effects";

export function setRole(
  context: EnvioContext,
  chainId: number,
  role: string
): void {
  context.Role.set({
    id: roleId(chainId, role),
    chainId,
    role,
  });
}

export async function ensureKernelSeeded(
  context: EnvioContext,
  chainId: number
): Promise<void> {
  const constants = getKernelConstants(chainId);
  const id = contractId(chainId, constants.address);
  const existing = await context.Contract.get(id);
  if (existing) {
    return;
  }

  const timestamp = BigInt(constants.creationTimestamp);
  const blockNumber = BigInt(constants.creationBlockNumber);
  const initialExecutor = await getKernelExecutor(
    context,
    constants.address,
    chainId,
    blockNumber
  );

  context.ActionExecutedEvent.set({
    id: actionExecutedEventId(
      chainId,
      constants.address,
      constants.creationTransactionHash,
      0
    ),
    chainId,
    kernel: constants.address,
    transactionHash: constants.creationTransactionHash,
    logIndex: 0,
    timestamp,
    blockNumber,
    action: "migrateKernel",
    target: constants.address,
  });

  context.ContractEvent.set({
    id: contractEventId(
      chainId,
      constants.creationTransactionHash,
      0,
      "migrateKernel",
      constants.address
    ),
    chainId,
    transactionHash: constants.creationTransactionHash,
    logIndex: 0,
    action: "migrateKernel",
    address: constants.address,
    timestamp,
    blockNumber,
    name: "Kernel",
    contractType: "KERNEL",
    isEnabled: true,
  });

  context.Contract.set({
    id,
    chainId,
    address: constants.address,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    name: "Kernel",
    contractType: "KERNEL",
    isEnabled: true,
  });

  context.KernelExecutor.set({
    id: kernelExecutorId(chainId, constants.address),
    chainId,
    kernel: constants.address,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    executor: initialExecutor,
  });

  context.KernelExecutorEvent.set({
    id: kernelExecutorEventId(
      chainId,
      constants.address,
      constants.creationTransactionHash,
      0
    ),
    chainId,
    kernel: constants.address,
    transactionHash: constants.creationTransactionHash,
    logIndex: 0,
    timestamp,
    blockNumber,
    executor: initialExecutor,
  });
}

export async function ensureRolesAdminSeeded(
  context: EnvioContext,
  chainId: number
): Promise<void> {
  const constants = getRolesAdminConstants(chainId);
  const id = currentRoleAssigneeId(chainId, ROLE_ROLES_ADMIN);
  const existing = await context.CurrentRoleAssignee.get(id);
  if (existing) {
    return;
  }

  const timestamp = BigInt(constants.creationTimestamp);
  const blockNumber = BigInt(constants.creationBlockNumber);
  const initialAdmin = await getRolesAdmin(
    context,
    constants.address,
    chainId,
    blockNumber
  );
  const assigneeName = getContractName(initialAdmin, chainId);

  context.RoleEvent.set({
    id: roleEventId(
      chainId,
      ROLE_ROLES_ADMIN,
      constants.creationTransactionHash,
      0,
      initialAdmin
    ),
    chainId,
    role: ROLE_ROLES_ADMIN,
    transactionHash: constants.creationTransactionHash,
    logIndex: 0,
    assignee: initialAdmin,
    timestamp,
    blockNumber,
    assigneeName,
    isGranted: true,
  });

  context.RoleAssignment.set({
    id: roleAssignmentId(chainId, ROLE_ROLES_ADMIN, initialAdmin),
    chainId,
    role: ROLE_ROLES_ADMIN,
    assignee: initialAdmin,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    assigneeName,
    isGranted: true,
  });

  context.CurrentRoleAssignee.set({
    id,
    chainId,
    role: ROLE_ROLES_ADMIN,
    assignee: initialAdmin,
    assigneeName,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
  });

  setRole(context, chainId, ROLE_ROLES_ADMIN);
}
