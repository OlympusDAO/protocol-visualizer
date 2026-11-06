import type {
  BridgeConfiguration,
  BridgeRoute,
} from "../../../../../packages/snapshot-artifacts/src/index";
import inventory from "../../../../../packages/protocol-config/other-contracts.json";
import externalChains from "../../../../../packages/protocol-config/ccip-external-chains.json";
import { SUPPORTED_CHAINS, type ProtocolChain } from "../../lib/constants";
import type { ProtocolVisualizerData } from "../../services/contracts";

export type Lane = {
  id: string;
  source: ProtocolChain;
  destination: ProtocolChain | null;
  destinationName: string;
  selector: string;
  status: "configured" | "blocked" | "unknown";
  blockers: string[];
  unknowns: string[];
  sourcePool?: BridgeConfiguration;
  destinationPool?: BridgeConfiguration;
  sourceBridge?: BridgeConfiguration;
  destinationBridge?: BridgeConfiguration;
  outbound?: BridgeRoute;
  inbound?: BridgeRoute;
};
export const isCurrentConfiguration = (row?: BridgeConfiguration) =>
  Boolean(
    row?.configuration &&
      row.observedAt &&
      row.verification.outcome === "match" &&
      (!row.lastChange ||
        BigInt(row.observedAt.number) >= BigInt(row.lastChange.number))
  );
const nonzero = (value?: string | null) =>
  Boolean(value && !/^0x0{40}$/.test(value));
/** EVM remote identifiers may be packed addresses or ABI-encoded addresses; other families stay opaque. */
export function evmAddress(value?: string) {
  if (!value) return null;
  if (/^0x[0-9a-f]{40}$/i.test(value)) return value.toLowerCase();
  if (/^0x0{24}[0-9a-f]{40}$/i.test(value))
    return `0x${value.slice(-40).toLowerCase()}`;
  return null;
}

function endpoints(chainId: number, data?: ProtocolVisualizerData) {
  const configurations = data?.bridgeConfigurations ?? [];
  const registration = data?.relationships.find(
    (row) => row.kind === "registered-pool"
  );
  const configured = data?.relationships.find(
    (row) => row.kind === "configured-pool"
  );
  const poolAddress = nonzero(registration?.value)
    ? registration?.value
    : configured?.value;
  const pool = configurations.find(
    (row) => row.kind === "pool" && row.address === poolAddress
  );
  const primaryBridge = inventory.find(
    (row) =>
      row.chainId === chainId &&
      row.name === "CCIPCrossChainBridge" &&
      !row.labelOnly
  );
  const bridge =
    configurations.find(
      (row) => row.kind === "bridge" && row.address === primaryBridge?.address
    ) ?? configurations.find((row) => row.kind === "bridge");
  return { pool, bridge, registration };
}

export function getBridgeLanes(
  snapshots: Map<number, ProtocolVisualizerData>
): Lane[] {
  const lanes: Lane[] = [];
  for (const source of SUPPORTED_CHAINS) {
    if (!source.ccipSelector) continue;
    const sourceData = snapshots.get(source.chainId);
    const from = endpoints(source.chainId, sourceData);
    // Candidate arrows come from observations, never from the deployment inventory alone.
    const selectors = new Set([
      ...(from.pool?.configuration?.routes.map((route) => route.selector) ??
        []),
      ...(from.bridge?.configuration?.routes
        .filter((route) => route.trustedRemote)
        .map((route) => route.selector) ?? []),
    ]);
    for (const selector of [...selectors].sort()) {
      if (selector === source.ccipSelector) continue;
      const destination =
        SUPPORTED_CHAINS.find((chain) => chain.ccipSelector === selector) ??
        null;
      const destinationData = destination
        ? snapshots.get(destination.chainId)
        : undefined;
      const to = endpoints(destination?.chainId ?? 0, destinationData);
      const lane: Lane = {
        id: `${source.chainId}:${selector}`,
        source,
        destination,
        destinationName:
          destination?.name ??
          externalChains.find((chain) => chain.selector === selector)?.name ??
          `Selector ${selector}`,
        selector,
        status: "unknown",
        blockers: [],
        unknowns: [],
        sourcePool: from.pool,
        destinationPool: to.pool,
        sourceBridge: from.bridge,
        destinationBridge: to.bridge,
      };
      const check = (
        value: boolean | null,
        failure: string,
        unknown = failure
      ) => {
        if (value === false) lane.blockers.push(failure);
        else if (value === null) lane.unknowns.push(unknown);
      };
      for (const [label, endpoint, data] of [
        ["Source", from, sourceData],
        ["Destination", to, destinationData],
      ] as const) {
        const registration = endpoint.registration;
        if (registration?.verification?.outcome === "mismatch")
          lane.unknowns.push(
            `${label} pool registration disagrees with its getter.`
          );
        check(
          registration?.value == null ||
            registration.verification?.outcome === "mismatch"
            ? null
            : nonzero(registration.value),
          `${label} OHM has no registered pool.`,
          `${label} pool registration is unavailable.`
        );
        for (const [kind, row] of [
          ["pool", endpoint.pool],
          ["bridge", endpoint.bridge],
        ] as const) {
          check(
            isCurrentConfiguration(row) ? true : null,
            "",
            `${label} ${kind} configuration is unavailable or stale.`
          );
          if (!row) continue;
          const state = data?.contractStates.find(
            (state) => state.address === row.address
          );
          if (state?.enabled === false)
            lane.blockers.push(`${label} ${kind} is disabled.`);
          else if (
            state?.enablerCapability === "supported" &&
            state.enabled === null
          )
            lane.unknowns.push(`${label} ${kind} enablement is unknown.`);
          if (kind === "pool" && state?.kernelMembership === "inactive")
            lane.blockers.push(
              `${label} pool policy is inactive in its Kernel.`
            );
        }
        if (
          isCurrentConfiguration(endpoint.pool) &&
          isCurrentConfiguration(endpoint.bridge)
        ) {
          if (registration?.scope?.token)
            check(
              endpoint.pool?.configuration?.token === registration.scope.token,
              `${label} pool token does not match OHM in the registry.`
            );
          check(
            endpoint.pool?.configuration?.router ===
              endpoint.bridge?.configuration?.router,
            `${label} pool and bridge use different routers.`
          );
          check(
            endpoint.pool?.configuration?.token ===
              endpoint.bridge?.configuration?.token,
            `${label} pool and bridge use different tokens.`
          );
        }
      }
      if (!destination)
        lane.unknowns.push(
          `${lane.destinationName} is outside the indexed EVM chain catalog.`
        );
      const outgoing = from.pool?.configuration?.routes.find(
        (route) => route.selector === selector
      );
      const incoming = to.pool?.configuration?.routes.find(
        (route) => route.selector === source.ccipSelector
      );
      lane.outbound = outgoing;
      lane.inbound = incoming;
      if (isCurrentConfiguration(from.pool)) {
        check(Boolean(outgoing), "Source pool has no route to this chain.");
        if (outgoing) {
          check(
            outgoing.routerSupported,
            "Source router does not support this chain.",
            "Source router support is unknown."
          );
          if (isCurrentConfiguration(to.pool))
            check(
              evmAddress(outgoing.remoteToken) ===
                to.pool?.configuration?.token,
              "Source pool's remote token does not match the destination token."
            );
          if (
            outgoing.outbound?.isEnabled &&
            outgoing.outbound.capacity === "0" &&
            outgoing.outbound.rate === "0"
          )
            lane.blockers.push(
              "Source outbound rate limit blocks all transfers."
            );
          if (from.pool?.configuration?.allowList !== null && from.bridge)
            check(
              from.pool?.configuration?.allowList?.includes(
                from.bridge.address
              ) ?? null,
              "Source bridge is not on the pool allowlist."
            );
        }
      }
      if (isCurrentConfiguration(to.pool)) {
        check(
          Boolean(incoming),
          "Destination pool has no inbound route from this chain."
        );
        if (incoming && from.pool)
          check(
            incoming.remotePools?.some(
              (pool) => evmAddress(pool) === from.pool?.address
            ) ?? null,
            "Destination pool does not accept the source pool."
          );
        if (
          incoming?.inbound?.isEnabled &&
          incoming.inbound.capacity === "0" &&
          incoming.inbound.rate === "0"
        )
          lane.blockers.push(
            "Destination inbound rate limit blocks all transfers."
          );
      }
      for (const [label, local, remote, remoteSelector] of [
        ["Source", from, to, selector],
        ["Destination", to, from, source.ccipSelector],
      ] as const) {
        if (!isCurrentConfiguration(local.bridge)) continue;
        const trust = local.bridge?.configuration?.routes.find(
          (route) => route.selector === remoteSelector
        );
        if (!trust?.trustedRemote) {
          lane.blockers.push(
            `${label} bridge has no trusted remote for this chain.`
          );
          continue;
        }
        check(
          remote.bridge ? trust?.trustedRemote === remote.bridge.address : null,
          `${label} bridge's trusted remote does not match its counterpart.`,
          `${label} trusted-remote counterpart is unavailable.`
        );
      }
      const registrationMismatch = [from.registration, to.registration].some(
        (row) => row?.verification?.outcome === "mismatch"
      );
      lane.status = registrationMismatch
        ? "unknown"
        : lane.blockers.length
          ? "blocked"
          : lane.unknowns.length
            ? "unknown"
            : "configured";
      lanes.push(lane);
    }
  }
  return lanes;
}

export function getBridgeCirclePositions(count: number) {
  const radius = Math.max(240, count * 42);
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    const x = Math.cos(angle),
      y = Math.sin(angle);
    return {
      x: radius + 140 + x * radius - 115,
      y: radius + 70 + y * radius - 55,
      side:
        Math.abs(x) > Math.abs(y)
          ? x > 0
            ? "left"
            : "right"
          : y > 0
            ? "top"
            : "bottom",
    };
  });
}

export function getBridgeLaneCurve(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  offset: number
) {
  const dx = targetX - sourceX,
    dy = targetY - sourceY,
    length = Math.hypot(dx, dy) || 1;
  const x = (sourceX + targetX) / 2 - (dy / length) * offset;
  const y = (sourceY + targetY) / 2 + (dx / length) * offset;
  return {
    path: `M ${sourceX},${sourceY} Q ${x},${y} ${targetX},${targetY}`,
    labelX: sourceX / 4 + x / 2 + targetX / 4,
    labelY: sourceY / 4 + y / 2 + targetY / 4,
  };
}
