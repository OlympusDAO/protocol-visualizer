import type {
  ContractState,
  ChainObservation,
} from "../../../../../packages/snapshot-artifacts/src/index";

export function getGraphContractName(contract: {
  name: string;
  version?: string | null;
}): string {
  return contract.version
    ? `${contract.name} (${contract.version})`
    : contract.name;
}

export function getKernelLabel(contract: {
  isEnabled?: boolean;
  category?: string;
}): string {
  return typeof contract.isEnabled === "boolean"
    ? `Kernel ${contract.isEnabled ? "active" : "inactive"}`
    : contract.category === "inactive-core"
      ? "Kernel inactive"
      : "External deployment";
}

export function getContractPalette(contract: {
  type?: string;
  category?: string;
  contractType?: string;
}): "kernel" | "module" | "policy" | "external" {
  const type =
    contract.type ??
    (contract.category === "inactive-core"
      ? contract.contractType?.toLowerCase()
      : undefined);
  return type === "kernel" || type === "module" || type === "policy"
    ? type
    : "external";
}

export function getEnablementPresentation(
  state?: ContractState,
  observation?: ChainObservation | null
) {
  const badge =
    state?.enabled == null
      ? null
      : state.enabled
        ? "Contract enabled"
        : "Contract disabled";
  const details: string[] = [];
  if (state?.enablerCapability === "unsupported")
    details.push("Verified ABI does not implement IEnabler.");
  else if (state?.enabled == null)
    details.push(
      "IEnabler state is unknown; no successful seed or indexed transition establishes it."
    );
  if (state?.seed)
    details.push(`Seeded at block ${state.seed.number} (${state.seed.hash}).`);
  if (state?.lastChange)
    details.push(
      `Last transition at block ${state.lastChange.number}, transaction ${state.lastChange.transactionHash}, log ${state.lastChange.logIndex}.`
    );
  if (state?.lastChange?.caller)
    details.push(
      `Transition caller ${state.lastChange.caller}; payload ${state.lastChange.data ?? "0x"}; lastTransitionAt ${state.lastChange.lastTransitionAt ?? state.lastChange.timestamp}.`
    );
  if (
    state?.lastChange &&
    (!state.indexedThrough ||
      BigInt(state.lastChange.number) > BigInt(state.indexedThrough.number))
  )
    details.push(
      "Latest transition awaits a completed verification checkpoint."
    );
  if (state?.indexedThrough)
    details.push(
      `Enablement indexed through block ${state.indexedThrough.number} (${state.indexedThrough.hash}).`
    );
  if (
    observation &&
    (!state?.indexedThrough ||
      BigInt(state.indexedThrough.number) <
        BigInt(observation.indexedThrough.number))
  )
    details.push(
      `Enablement coverage is behind chain observation block ${observation.indexedThrough.number}.`
    );
  const verification = state?.verification;
  let warning: string | null = null;
  if (verification?.outcome === "mismatch") {
    warning = `Verification mismatch: indexed ${state?.enabled}, getter ${verification.getterValue} at block ${verification.block?.number} (${verification.block?.hash}).`;
    details.push(warning);
  } else if (verification?.outcome === "unavailable") {
    details.push(
      `Getter verification unavailable${verification.block ? ` at block ${verification.block.number}` : ""}; established indexed state is retained.`
    );
  } else if (verification?.outcome === "match") {
    details.push(
      `Getter matches indexed state at block ${verification.block?.number}.`
    );
  }
  return { badge, warning, details };
}

export function refreshGraph<
  T extends { id: string; position: { x: number; y: number } },
>(
  next: T[],
  previous: T[],
  selected: string | null
): { nodes: T[]; selectedNode: string | null } {
  const normalize = (id: string) =>
    id.startsWith("0x") || id.startsWith("assignee-") ? id.toLowerCase() : id;
  const positions = new Map(
    previous.map((node) => [normalize(node.id), node.position])
  );
  const nodes = new Map<string, T>();
  for (const node of next) {
    const id = normalize(node.id);
    if (!nodes.has(id))
      nodes.set(id, {
        ...node,
        id,
        position: positions.get(id) ?? node.position,
      });
  }
  const selectedNode =
    selected && nodes.has(normalize(selected)) ? normalize(selected) : null;
  return { nodes: [...nodes.values()], selectedNode };
}
