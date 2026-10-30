import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Position,
  type Node,
  type Edge,
} from "reactflow";
import { SUPPORTED_CHAINS, type ProtocolChain } from "../../lib/constants";
import { getProtocolVisualizerData } from "../../services/contracts";
import type {
  BridgeConfiguration,
  BridgeRateLimit,
} from "../../../../../packages/snapshot-artifacts/src/index";
import { BridgeLaneEdge } from "./lane-edge";
import {
  getBridgeLanes,
  isCurrentConfiguration,
  getBridgeCirclePositions,
} from "./model";

const colors = {
  configured: "var(--success)",
  blocked: "var(--warning)",
  unknown: "var(--muted)",
};
const edgeTypes = { lane: BridgeLaneEdge };
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
function contractLink(chain: ProtocolChain, address: string) {
  return `?chain=${chain.chainId}&node=${address}`;
}
function Endpoint({
  chain,
  name,
  pool,
  bridge,
}: {
  chain: ProtocolChain | null;
  name?: string;
  pool?: BridgeConfiguration;
  bridge?: BridgeConfiguration;
}) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">
        {chain?.name ?? name ?? "Unindexed destination"}
      </h3>
      {(
        [
          ["Bridge", bridge],
          ["Pool", pool],
        ] as const
      ).map(([name, row]) => (
        <div key={name} className="text-sm">
          <span className="text-muted">{name}: </span>
          {row && chain ? (
            <a
              className="text-link underline underline-offset-2"
              href={contractLink(chain, row.address)}
              title={row.address}
            >
              {short(row.address)}
            </a>
          ) : (
            "Unavailable"
          )}
          {row?.observedAt && (
            <span className="ml-2 text-xs text-muted">
              block {row.observedAt.number}
              {!isCurrentConfiguration(row) && " · unverified"}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
function RateLimit({ name, value }: { name: string; value?: BridgeRateLimit }) {
  const amount = (value: string) => {
    const n = BigInt(value);
    return `${n / 1_000_000_000n}${
      n % 1_000_000_000n
        ? `.${String(n % 1_000_000_000n)
            .padStart(9, "0")
            .replace(/0+$/, "")}`
        : ""
    }`;
  };
  return (
    <p className="text-sm">
      <span className="text-muted">{name}: </span>
      {!value
        ? "Unknown"
        : !value.isEnabled
          ? "Unlimited (rate limiting disabled)"
          : `${amount(value.capacity)} OHM capacity · ${amount(value.rate)} OHM/s refill`}
    </p>
  );
}
export function BridgeLanes() {
  const [environment, setEnvironment] = useState(() =>
    new URL(window.location.href).searchParams.get("environment") === "testnet"
      ? "testnet"
      : "production"
  );
  const [selected, setSelected] = useState<string | null>(() =>
    new URL(window.location.href).searchParams.get("lane")
  );
  useEffect(() => {
    const restore = () => {
      const url = new URL(window.location.href);
      setEnvironment(
        url.searchParams.get("environment") === "testnet"
          ? "testnet"
          : "production"
      );
      setSelected(url.searchParams.get("lane"));
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const navigate = (nextEnvironment: string, lane: string | null) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "bridges");
    if (nextEnvironment === "testnet")
      url.searchParams.set("environment", nextEnvironment);
    else url.searchParams.delete("environment");
    if (lane) url.searchParams.set("lane", lane);
    else url.searchParams.delete("lane");
    if (url.href !== window.location.href)
      window.history.pushState(null, "", url);
    setEnvironment(nextEnvironment);
    setSelected(lane);
  };
  const chains = SUPPORTED_CHAINS.filter(
    (chain) => chain.availability === "indexed"
  );
  const queries = useQueries({
    queries: chains.map((chain) => ({
      queryKey: ["protocol-visualizer", chain.chainId],
      queryFn: () => getProtocolVisualizerData(chain.chainId),
      refetchInterval: 60_000,
      retry: false,
    })),
  });
  const snapshots = new Map(
    queries.flatMap((query, index) =>
      query.data ? [[chains[index].chainId, query.data] as const] : []
    )
  );
  const lanes = getBridgeLanes(snapshots).filter(
    (lane) => lane.source.environment === environment
  );
  const currentLane = lanes.find((lane) => lane.id === selected);
  const failedChains = queries.flatMap((query, index) =>
    query.isError && chains[index].environment === environment
      ? [chains[index].name]
      : []
  );
  const hasObservations = [...snapshots.entries()].some(
    ([id, data]) =>
      chains.find((chain) => chain.chainId === id)?.environment ===
        environment && data.bridgeConfigurations.some(isCurrentConfiguration)
  );
  const graph = (() => {
    const nodes: Node[] = chains
      .filter((chain) => chain.environment === environment)
      .map((chain) => {
        const data = snapshots.get(chain.chainId);
        const outgoing = lanes.filter(
          (lane) => lane.source.chainId === chain.chainId
        );
        const observed = data?.bridgeConfigurations.some(
          isCurrentConfiguration
        );
        return {
          id: String(chain.chainId),
          position: { x: 0, y: 0 },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          style: {
            width: 230,
            borderRadius: 8,
            padding: 18,
            borderColor: "var(--ui-border)",
            background: observed ? "var(--surface)" : "var(--surface-muted)",
          },
          data: {
            name: chain.name,
            label: (
              <div>
                <strong className="text-base">{chain.name}</strong>
                <div className="mt-2 text-xs text-muted">
                  {!data
                    ? queries[chains.indexOf(chain)].isPending
                      ? "Loading snapshot…"
                      : "Snapshot unavailable"
                    : !observed
                      ? "Lane configuration unavailable"
                      : `${outgoing.length} outbound lane${outgoing.length === 1 ? "" : "s"} observed`}
                </div>
              </div>
            ),
          },
        };
      });
    for (const lane of lanes) {
      const id = lane.destination
        ? String(lane.destination.chainId)
        : `selector-${lane.selector}`;
      if (!nodes.some((node) => node.id === id))
        nodes.push({
          id,
          position: { x: 0, y: 0 },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          style: {
            width: 230,
            background: "var(--surface-muted)",
            borderColor: "var(--ui-border)",
            borderRadius: 8,
            padding: 18,
          },
          data: {
            name: lane.destinationName,
            label: (
              <>
                <strong>{lane.destinationName}</strong>
                <div className="mt-2 text-xs text-muted">
                  {lane.destination?.environment ?? "Not indexed"}
                </div>
              </>
            ),
          },
        });
    }
    const edges: Edge[] = lanes.map((lane) => {
      const label = `CCIP · ${lane.status}`;
      return {
        id: lane.id,
        source: String(lane.source.chainId),
        target: lane.destination
          ? String(lane.destination.chainId)
          : `selector-${lane.selector}`,
        type: "lane",
        label,
        ariaLabel: `${lane.source.name} to ${lane.destinationName}: ${lane.status}`,
        data: {
          offset: lanes.some(
            (other) =>
              other.source.chainId === lane.destination?.chainId &&
              other.destination?.chainId === lane.source.chainId
          )
            ? 120
            : 0,
        },
        style: {
          stroke: colors[lane.status],
          strokeWidth: lane.id === selected ? 3 : 2,
          opacity: selected && lane.id !== selected ? 0.3 : 1,
          ...(lane.status === "unknown" ? { strokeDasharray: "5 5" } : {}),
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: colors[lane.status] },
        labelStyle: { fontSize: 11 },
        labelBgPadding: [5, 3],
        labelBgBorderRadius: 3,
      };
    });
    const positions = getBridgeCirclePositions(nodes.length);
    return {
      nodes: nodes.map((node, index) => ({
        ...node,
        position: { x: positions[index].x, y: positions[index].y },
        sourcePosition: positions[index].side as Position,
        targetPosition: positions[index].side as Position,
      })),
      edges,
    };
  })();
  return (
    <section aria-label="Cross-chain bridge lanes" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">OHM bridge lanes</h2>
          <p className="mt-1 text-sm text-muted">
            Observed CCIP configuration. Each arrow is checked independently;
            select a lane for its contracts and blockers.
          </p>
        </div>
        <label className="text-sm">
          Networks{" "}
          <select
            aria-label="Bridge network group"
            value={environment}
            onChange={(event) => navigate(event.target.value, null)}
            className="ml-2 rounded border border-ui-border bg-surface px-3 py-2"
          >
            <option value="production">Production</option>
            <option value="testnet">Testnets</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-5 text-xs text-muted">
        {(["configured", "blocked", "unknown"] as const).map((status) => (
          <span key={status} className="flex items-center gap-2">
            <span
              className="inline-block h-0.5 w-6"
              style={{ background: colors[status] }}
            />
            {status === "configured"
              ? "Configuration checks pass"
              : status === "blocked"
                ? "Known blocker"
                : "Missing or stale evidence"}
          </span>
        ))}
      </div>
      <div className="h-[560px] rounded-lg border border-ui-border bg-surface sm:h-[640px]">
        <ReactFlow
          key={`${environment}:${graph.nodes.length}`}
          nodes={graph.nodes}
          edges={graph.edges}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={false}
          nodesConnectable={false}
          onEdgeClick={(_, edge) => navigate(environment, edge.id)}
          minZoom={0.15}
          maxZoom={1.8}
        >
          <Background color="var(--graph-dot)" gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {failedChains.length > 0 && (
        <p role="status" className="text-sm text-muted">
          Snapshots unavailable: {failedChains.join(", ")}. Their lane coverage
          remains unknown.
        </p>
      )}
      {queries.some((query) => query.isPending) && (
        <p role="status" className="text-sm text-muted">
          Loading available chain snapshots…
        </p>
      )}
      {!lanes.length && !queries.some((query) => query.isPending) && (
        <p className="rounded border border-ui-border bg-surface p-4 text-sm text-muted">
          {hasObservations
            ? "No outbound routes have been observed in the available configurations."
            : "Bridge-lane observations are unavailable in these snapshots."}{" "}
          Chains with unavailable configuration remain unknown.
        </p>
      )}
      {lanes.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-ui-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ui-border bg-background text-muted">
              <tr>
                <th className="px-4 py-3">Source</th>
                <th>Destination</th>
                <th>Configuration</th>
                <th className="px-4">Details</th>
              </tr>
            </thead>
            <tbody>
              {lanes.map((lane) => (
                <tr
                  key={lane.id}
                  className={`border-b border-ui-border ${selected === lane.id ? "bg-selection" : ""}`}
                >
                  <td className="px-4 py-3">{lane.source.name}</td>
                  <td>{lane.destinationName}</td>
                  <td>
                    <span
                      className="font-medium capitalize"
                      style={{ color: colors[lane.status] }}
                    >
                      {lane.status}
                    </span>
                    <div className="mt-1 text-xs text-muted">
                      {lane.blockers[0] ??
                        lane.unknowns[0] ??
                        "Pool and bridge configuration agree."}
                    </div>
                  </td>
                  <td className="px-4">
                    <button
                      type="button"
                      aria-label={`Inspect ${lane.source.name} to ${lane.destinationName}`}
                      onClick={() => navigate(environment, lane.id)}
                      className="rounded border border-ui-border px-3 py-1.5 hover:bg-surface-muted"
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {currentLane && (
        <section
          aria-label="Selected bridge lane"
          className="rounded-lg border border-ui-border bg-surface p-5"
        >
          <h2 className="text-lg font-semibold">
            {currentLane.source.name} → {currentLane.destinationName}
          </h2>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Endpoint
              chain={currentLane.source}
              pool={currentLane.sourcePool}
              bridge={currentLane.sourceBridge}
            />
            <Endpoint
              chain={currentLane.destination}
              name={currentLane.destinationName}
              pool={currentLane.destinationPool}
              bridge={currentLane.destinationBridge}
            />
          </div>
          {(currentLane.blockers.length > 0 ||
            currentLane.unknowns.length > 0) && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {[
                ["Known blockers", currentLane.blockers],
                ["Missing evidence", currentLane.unknowns],
              ].map(
                ([title, items]) =>
                  (items as string[]).length > 0 && (
                    <div key={title as string}>
                      <h3 className="text-sm font-semibold">
                        {title as string}
                      </h3>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                        {(items as string[]).map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )
              )}
            </div>
          )}
          <div className="mt-5 space-y-1 border-t border-ui-border pt-4">
            <RateLimit
              name="Source outbound limit"
              value={currentLane.outbound?.outbound}
            />
            <RateLimit
              name="Destination inbound limit"
              value={currentLane.inbound?.inbound}
            />
          </div>
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted">
              Pool and trusted-remote evidence
            </summary>
            <pre className="mt-2 overflow-auto rounded bg-background p-3 text-xs">
              {JSON.stringify(
                {
                  sourceSelector: currentLane.source.ccipSelector,
                  destinationSelector: currentLane.selector,
                  outbound: currentLane.outbound,
                  inbound: currentLane.inbound,
                  sourceTrustedRemote:
                    currentLane.sourceBridge?.configuration?.routes.find(
                      (route) => route.selector === currentLane.selector
                    )?.trustedRemote,
                  destinationTrustedRemote:
                    currentLane.destinationBridge?.configuration?.routes.find(
                      (route) =>
                        route.selector === currentLane.source.ccipSelector
                    )?.trustedRemote,
                  observations: [
                    currentLane.sourcePool,
                    currentLane.sourceBridge,
                    currentLane.destinationPool,
                    currentLane.destinationBridge,
                  ].map(
                    (row) =>
                      row && {
                        chainId: row.chainId,
                        address: row.address,
                        observedAt: row.observedAt,
                        lastChange: row.lastChange,
                        verification: row.verification,
                      }
                  ),
                },
                null,
                2
              )}
            </pre>
          </details>
          <p className="mt-4 text-xs text-muted">
            These are configuration checks at the displayed blocks, not a
            transfer simulation. Pool liquidity and CCIP execution health are
            not established by this view.
          </p>
        </section>
      )}
    </section>
  );
}
