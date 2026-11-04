import { fromHex } from "viem";

import { getContractName } from "../ContractNames";
import { ROLE_ROLES_ADMIN } from "../services/contracts/types";
import { currentRoleAssigneeId, roleAssignmentId } from "./ids";
import { ensureRolesAdminSeeded, setRole } from "./seeding";
import type {
  CurrentRoleAssigneeEntity,
  EnvioContext,
  NewAdminPulledEvent,
  RoleGrantedEvent,
  RoleRevokedEvent,
} from "./types";

export async function handleRoleGranted(
  event: RoleGrantedEvent,
  context: EnvioContext
): Promise<void> {
  const envioContext = context;
  await ensureRolesAdminSeeded(envioContext, event.chainId);

  const role = fromHex(event.params.role_, "string").replace(/\0/g, "");
  const assignee = event.params.addr_;
  const timestamp = BigInt(event.block.timestamp);
  const blockNumber = BigInt(event.block.number);
  const assigneeName = getContractName(assignee, event.chainId);

  console.log(
    `Chain ${event.chainId}: Processing role granted event for ${role} to ${assignee}`
  );

  envioContext.RoleAssignment.set({
    id: roleAssignmentId(event.chainId, role, assignee),
    role,
    assignee,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    assigneeName,
    isGranted: true,
  });

  setRole(envioContext, event.chainId, role);
}

export async function handleRoleRevoked(
  event: RoleRevokedEvent,
  context: EnvioContext
): Promise<void> {
  const envioContext = context;
  await ensureRolesAdminSeeded(envioContext, event.chainId);

  const role = fromHex(event.params.role_, "string").replace(/\0/g, "");
  const assignee = event.params.addr_;
  const timestamp = BigInt(event.block.timestamp);
  const blockNumber = BigInt(event.block.number);
  const assignmentId = roleAssignmentId(event.chainId, role, assignee);
  const existingAssignment = await envioContext.RoleAssignment.get<{
    assigneeName?: string;
  }>(assignmentId);
  const assigneeName =
    existingAssignment?.assigneeName ??
    getContractName(assignee, event.chainId);

  console.log(
    `Chain ${event.chainId}: Processing role revoked event for ${role} from ${assignee}`
  );

  envioContext.RoleAssignment.set({
    id: assignmentId,
    role,
    assignee,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    assigneeName,
    isGranted: false,
  });

  setRole(envioContext, event.chainId, role);
}

export async function handleNewAdminPulled(
  event: NewAdminPulledEvent,
  context: EnvioContext
): Promise<void> {
  const envioContext = context;
  await ensureRolesAdminSeeded(envioContext, event.chainId);

  const newAdmin = event.params.newAdmin_;
  const timestamp = BigInt(event.block.timestamp);
  const blockNumber = BigInt(event.block.number);
  const currentAssignee =
    await envioContext.CurrentRoleAssignee.get<CurrentRoleAssigneeEntity>(
      currentRoleAssigneeId(event.chainId, ROLE_ROLES_ADMIN)
    );

  console.log(
    `Chain ${event.chainId}: Processing new admin pulled event for ${newAdmin}`
  );

  if (currentAssignee) {
    envioContext.RoleAssignment.set({
      id: roleAssignmentId(
        event.chainId,
        ROLE_ROLES_ADMIN,
        currentAssignee.assignee
      ),
      role: ROLE_ROLES_ADMIN,
      assignee: currentAssignee.assignee,
      lastUpdatedTimestamp: timestamp,
      lastUpdatedBlockNumber: blockNumber,
      assigneeName: currentAssignee.assigneeName,
      isGranted: false,
    });
  }

  const assigneeName = getContractName(newAdmin, event.chainId);

  envioContext.RoleAssignment.set({
    id: roleAssignmentId(event.chainId, ROLE_ROLES_ADMIN, newAdmin),
    role: ROLE_ROLES_ADMIN,
    assignee: newAdmin,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    assigneeName,
    isGranted: true,
  });

  envioContext.CurrentRoleAssignee.set({
    id: currentRoleAssigneeId(event.chainId, ROLE_ROLES_ADMIN),
    role: ROLE_ROLES_ADMIN,
    assignee: newAdmin,
    assigneeName,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
  });

  setRole(envioContext, event.chainId, ROLE_ROLES_ADMIN);
}
