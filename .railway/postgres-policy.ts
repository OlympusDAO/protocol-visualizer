import { execFileSync } from "node:child_process";
import type { RailwayContext } from "railway/iac";

export const publicServices = new Set(["frontend", "snapshot-gateway"]);
const managedServices = new Set([
  ...publicServices,
  "Postgres",
  "rpc-cache-postgres",
  "indexer",
  "indexer-monitor",
  "hasura",
  "rpc-cache",
  "snapshot-publisher",
  "snapshot-monitor",
]);

export function tcpRemovals(name: string, imported: readonly string[] = []) {
  // CLI TCP maps are sparse: only explicit nulls remove proxies. Include imported
  // ports so an unexpected existing exposure cannot survive the managed defaults.
  const known: Record<string, number[]> = {
    Postgres: [5432],
    "rpc-cache-postgres": [5432],
    indexer: [9898, 9899],
    hasura: [8080],
    "rpc-cache": [4000, 4001],
    frontend: [8080],
    "snapshot-gateway": [8080],
  };
  return Object.fromEntries(
    [...new Set([...(known[name] ?? []).map(String), ...imported])].map(
      (port) => [port, null]
    )
  );
}

export function existingResources(ctx: RailwayContext):
  | {
      volumeSizes: ReadonlyMap<string, number>;
      tcpPorts: ReadonlyMap<string, readonly string[]>;
    }
  | undefined {
  if (!ctx.environmentId) return undefined;
  try {
    const result = JSON.parse(
      execFileSync(
        "railway",
        [
          "api",
          "query($id: String!) { environment(id: $id) { config(decryptVariables: false) serviceInstances(first: 100) { edges { node { serviceId serviceName domains { serviceDomains { domain } customDomains { domain } } } } pageInfo { hasNextPage } } volumeInstances(first: 100) { edges { node { sizeMB volume { name } } } pageInfo { hasNextPage } } } }",
          "--var",
          `id=${ctx.environmentId}`,
          "--compact",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }
      )
    );
    const services = result.data?.environment?.serviceInstances;
    const volumes = result.data?.environment?.volumeInstances;
    if (
      result.errors?.length ||
      !Array.isArray(services?.edges) ||
      services.pageInfo?.hasNextPage !== false ||
      services.edges.some(
        (edge: { node?: { serviceName?: unknown } }) =>
          typeof edge.node?.serviceName !== "string" ||
          !edge.node.serviceName.trim()
      ) ||
      !Array.isArray(volumes?.edges) ||
      volumes.pageInfo?.hasNextPage !== false ||
      volumes.edges.some(
        (edge: { node?: { sizeMB?: unknown; volume?: { name?: unknown } } }) =>
          typeof edge.node?.volume?.name !== "string" ||
          !edge.node.volume.name.trim() ||
          typeof edge.node.sizeMB !== "number" ||
          !Number.isSafeInteger(edge.node.sizeMB) ||
          edge.node.sizeMB <= 0
      )
    )
      throw new Error("Incomplete resource lookup");
    const volumeSizes = new Map<string, number>(
      volumes.edges.map(
        (edge: { node: { sizeMB: number; volume: { name: string } } }) => [
          edge.node.volume.name,
          edge.node.sizeMB,
        ]
      )
    );
    if (volumeSizes.size !== volumes.edges.length)
      throw new Error("Ambiguous volume lookup");
    // Config is captured in memory only; never print or persist its variables.
    const config = result.data?.environment?.config;
    const configured =
      config &&
      typeof config === "object" &&
      !Array.isArray(config) &&
      config.services === undefined &&
      services.edges.length === 0
        ? {}
        : config?.services;
    if (
      !configured ||
      typeof configured !== "object" ||
      Array.isArray(configured)
    )
      throw new Error("Missing environment networking configuration");
    const serviceIds = new Set(
      services.edges.map(
        ({ node }: { node: { serviceId: string } }) => node.serviceId
      )
    );
    // Reconcile both views; unknown or missing active metadata could hide a public
    // service or misclassify an existing database as new.
    if (
      serviceIds.size !== services.edges.length ||
      new Set(
        services.edges.map(
          ({ node }: { node: { serviceName: string } }) => node.serviceName
        )
      ).size !== services.edges.length ||
      Object.entries(configured).some(([id, config]) =>
        serviceIds.has(id)
          ? !config || typeof config !== "object" || Array.isArray(config)
          : config !== null &&
            (!config ||
              typeof config !== "object" ||
              Array.isArray(config) ||
              (config as { isDeleted?: unknown }).isDeleted !== true)
      )
    )
      throw new Error("Unaccounted active environment service configuration");
    const tcpPorts = new Map<string, readonly string[]>();
    for (const { node } of services.edges) {
      if (!managedServices.has(node.serviceName))
        throw new Error("Unexpected service in whole-project exposure lookup");
      if (
        typeof node.serviceId !== "string" ||
        !Object.hasOwn(configured, node.serviceId)
      )
        throw new Error("Incomplete service networking lookup");
      const domains = node.domains;
      if (
        ![domains?.serviceDomains, domains?.customDomains].every(Array.isArray)
      )
        throw new Error("Incomplete domain lookup");
      if (
        [...domains.serviceDomains, ...domains.customDomains].some(
          (domain) =>
            typeof domain?.domain !== "string" || !domain.domain.trim()
        )
      )
        throw new Error("Invalid domain metadata");
      // Empty domain maps cannot remove live HTTP domains through native apply.
      // Stop until separately approved provider removal has been verified.
      if (
        !publicServices.has(node.serviceName) &&
        (domains.serviceDomains.length || domains.customDomains.length)
      )
        throw new Error(
          "Existing private service has public HTTP domains; provider removal and verification required"
        );
      const networking = configured[node.serviceId]?.networking;
      if (
        networking != null &&
        (typeof networking !== "object" || Array.isArray(networking))
      )
        throw new Error("Invalid networking metadata");
      const proxies = networking?.tcpProxies ?? {};
      if (
        !proxies ||
        typeof proxies !== "object" ||
        Array.isArray(proxies) ||
        Object.values(proxies).some(
          (value) =>
            value !== null &&
            (typeof value !== "object" || Array.isArray(value))
        ) ||
        Object.keys(proxies).some(
          (port) =>
            !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535
        )
      )
        throw new Error("Invalid TCP proxy metadata");
      tcpPorts.set(node.serviceName, Object.keys(proxies));
    }
    return {
      volumeSizes,
      tcpPorts,
    };
  } catch {
    throw new Error(
      "Cannot establish safe existing Railway services, volumes and exposure; refusing to plan database passwords or capacity. Verify private HTTP domains were removed separately and networking metadata is complete."
    );
  }
}
