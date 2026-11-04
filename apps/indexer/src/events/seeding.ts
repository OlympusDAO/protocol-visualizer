import { getContractName } from "../ContractNames";
import { getKernelConstants, getRolesAdminConstants } from "../constants";
import { ROLE_ROLES_ADMIN } from "../services/contracts/types";
import { getKernelExecutor, getRolesAdmin } from "./effects";
import {
  contractId,
  currentRoleAssigneeId,
  kernelExecutorId,
  roleAssignmentId,
  roleId,
} from "./ids";
import type { EnvioContext } from "./types";

export function setRole(
  context: EnvioContext,
  chainId: number,
  role: string
): void {
  context.Role.set({
    id: roleId(chainId, role),
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

  context.Contract.set({
    id,
    address: constants.address,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    name: "Kernel",
    contractType: "KERNEL",
    isEnabled: true,
  });

  context.KernelExecutor.set({
    id: kernelExecutorId(chainId, constants.address),
    kernel: constants.address,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
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

  context.RoleAssignment.set({
    id: roleAssignmentId(chainId, ROLE_ROLES_ADMIN, initialAdmin),
    role: ROLE_ROLES_ADMIN,
    assignee: initialAdmin,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    assigneeName,
    isGranted: true,
  });

  context.CurrentRoleAssignee.set({
    id,
    role: ROLE_ROLES_ADMIN,
    assignee: initialAdmin,
    assigneeName,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
  });

  setRole(context, chainId, ROLE_ROLES_ADMIN);
}
