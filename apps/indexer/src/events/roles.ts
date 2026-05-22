import { fromHex } from "viem";

import { getContractName } from "../ContractNames";
import { ROLE_ROLES_ADMIN } from "../services/contracts/types";
import { currentRoleAssigneeId, roleAssignmentId, roleEventId } from "./ids";
import type {
  CurrentRoleAssigneeEntity,
  EnvioContext,
  NewAdminPulledEvent,
  RoleGrantedEvent,
  RoleRevokedEvent,
} from "./types";
import { ensureRolesAdminSeeded, setRole } from "./seeding";

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

  envioContext.RoleEvent.set({
    id: roleEventId(
      event.chainId,
      role,
      event.transaction.hash,
      event.logIndex,
      assignee
    ),
    chainId: event.chainId,
    role,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    assignee,
    timestamp,
    blockNumber,
    assigneeName,
    isGranted: true,
  });

  envioContext.RoleAssignment.set({
    id: roleAssignmentId(event.chainId, role, assignee),
    chainId: event.chainId,
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

  envioContext.RoleEvent.set({
    id: roleEventId(
      event.chainId,
      role,
      event.transaction.hash,
      event.logIndex,
      assignee
    ),
    chainId: event.chainId,
    role,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    assignee,
    timestamp,
    blockNumber,
    assigneeName,
    isGranted: false,
  });

  envioContext.RoleAssignment.set({
    id: assignmentId,
    chainId: event.chainId,
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
    envioContext.RoleEvent.set({
      id: roleEventId(
        event.chainId,
        ROLE_ROLES_ADMIN,
        event.transaction.hash,
        event.logIndex,
        currentAssignee.assignee
      ),
      chainId: event.chainId,
      role: ROLE_ROLES_ADMIN,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
      assignee: currentAssignee.assignee,
      timestamp,
      blockNumber,
      assigneeName: currentAssignee.assigneeName,
      isGranted: false,
    });

    envioContext.RoleAssignment.set({
      id: roleAssignmentId(
        event.chainId,
        ROLE_ROLES_ADMIN,
        currentAssignee.assignee
      ),
      chainId: event.chainId,
      role: ROLE_ROLES_ADMIN,
      assignee: currentAssignee.assignee,
      lastUpdatedTimestamp: timestamp,
      lastUpdatedBlockNumber: blockNumber,
      assigneeName: currentAssignee.assigneeName,
      isGranted: false,
    });
  }

  const assigneeName = getContractName(newAdmin, event.chainId);
  envioContext.RoleEvent.set({
    id: roleEventId(
      event.chainId,
      ROLE_ROLES_ADMIN,
      event.transaction.hash,
      event.logIndex,
      newAdmin
    ),
    chainId: event.chainId,
    role: ROLE_ROLES_ADMIN,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    assignee: newAdmin,
    timestamp,
    blockNumber,
    assigneeName,
    isGranted: true,
  });

  envioContext.RoleAssignment.set({
    id: roleAssignmentId(event.chainId, ROLE_ROLES_ADMIN, newAdmin),
    chainId: event.chainId,
    role: ROLE_ROLES_ADMIN,
    assignee: newAdmin,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
    assigneeName,
    isGranted: true,
  });

  envioContext.CurrentRoleAssignee.set({
    id: currentRoleAssigneeId(event.chainId, ROLE_ROLES_ADMIN),
    chainId: event.chainId,
    role: ROLE_ROLES_ADMIN,
    assignee: newAdmin,
    assigneeName,
    lastUpdatedTimestamp: timestamp,
    lastUpdatedBlockNumber: blockNumber,
  });

  setRole(envioContext, event.chainId, ROLE_ROLES_ADMIN);
}
