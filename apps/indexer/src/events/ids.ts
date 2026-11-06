import type { ControlEvent } from "./types";

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function contractId(chainId: number, address: string): string {
  return `${chainId}:${normalizeAddress(address)}`;
}

export function kernelExecutorId(chainId: number, kernel: string): string {
  return `${chainId}:${normalizeAddress(kernel)}`;
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

export function currentModuleId(chainId: number, keycode: string): string {
  return `${chainId}:${keycode}`;
}

export function currentRoleAssigneeId(chainId: number, role: string): string {
  return `${chainId}:${role}`;
}

export function controlTransitionId(event: ControlEvent, kind: string): string {
  return `${contractId(event.chainId, event.srcAddress)}:${event.block.hash.toLowerCase()}:${event.block.number}:${event.block.timestamp}:${event.transaction.hash.toLowerCase()}:${event.logIndex}:${kind}`;
}
