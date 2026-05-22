import type { ActionType } from "./types";

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function contractId(chainId: number, address: string): string {
  return `${chainId}:${normalizeAddress(address)}`;
}

export function contractEventId(
  chainId: number,
  transactionHash: string,
  logIndex: number,
  action: ActionType,
  address: string
): string {
  return `${chainId}:${transactionHash}:${logIndex}:${action}:${normalizeAddress(
    address
  )}`;
}

export function actionExecutedEventId(
  chainId: number,
  kernel: string,
  transactionHash: string,
  logIndex: number
): string {
  return `${chainId}:${normalizeAddress(kernel)}:${transactionHash}:${logIndex}`;
}

export function kernelExecutorId(chainId: number, kernel: string): string {
  return `${chainId}:${normalizeAddress(kernel)}`;
}

export function kernelExecutorEventId(
  chainId: number,
  kernel: string,
  transactionHash: string,
  logIndex: number
): string {
  return `${chainId}:${normalizeAddress(kernel)}:${transactionHash}:${logIndex}`;
}

export function roleId(chainId: number, role: string): string {
  return `${chainId}:${role}`;
}

export function roleAssignmentId(
  chainId: number,
  role: string,
  assignee: string
): string {
  return `${chainId}:${role}:${normalizeAddress(assignee)}`;
}

export function roleEventId(
  chainId: number,
  role: string,
  transactionHash: string,
  logIndex: number,
  assignee: string
): string {
  return `${chainId}:${role}:${transactionHash}:${logIndex}:${normalizeAddress(
    assignee
  )}`;
}

export function currentModuleId(chainId: number, keycode: string): string {
  return `${chainId}:${keycode}`;
}

export function currentRoleAssigneeId(chainId: number, role: string): string {
  return `${chainId}:${role}`;
}
