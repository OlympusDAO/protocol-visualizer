import { execFileSync } from "node:child_process";
import type { RailwayContext } from "railway/iac";

export const publicHttpTargetPorts = {
  frontend: 8080,
  "snapshot-gateway": 8080,
} as const;
const knownPorts: Record<string, number[]> = {
  Postgres: [5432],
  "rpc-cache-postgres": [5432],
  indexer: [9898, 9899],
  "indexer-monitor": [],
  hasura: [8080],
  "rpc-cache": [4000, 4001],
  frontend: [publicHttpTargetPorts.frontend],
  "snapshot-gateway": [publicHttpTargetPorts["snapshot-gateway"]],
  "snapshot-publisher": [],
  "snapshot-monitor": [],
};

export function tcpRemovals(name: string, imported: readonly string[] = []) {
  // CLI TCP maps are sparse: only explicit nulls remove proxies. Include imported
  // ports so an unexpected existing exposure cannot survive the managed defaults.
  return Object.fromEntries(
    [...new Set([...(knownPorts[name] ?? []).map(String), ...imported])].map(
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
  const { volumeSizes, tcpPorts, httpPorts } = readExistingResources(
    ctx.environmentId
  );
  for (const [name, ports] of httpPorts) {
    if (!Object.hasOwn(publicHttpTargetPorts, name))
      throw new Error(
        `Unexpected HTTP exposure on ${name}. Obtain separate authorization for native domain removal and verify it before planning.`
      );
    const target =
      publicHttpTargetPorts[name as keyof typeof publicHttpTargetPorts];
    if (ports.some((port) => port !== null && port !== target))
      throw new Error(
        `Unexpected HTTP target port on ${name}: expected ${target} or automatic. Verify the routing and obtain separate authorization for any native repair before planning.`
      );
  }
  return { volumeSizes, tcpPorts };
}

function readExistingResources(environmentId: string) {
  try {
    const result = JSON.parse(
      execFileSync(
        "railway",
        [
          "api",
          "query($id: String!) { environment(id: $id) { config(decryptVariables: false) serviceInstances(first: 100) { edges { node { serviceId serviceName domains { serviceDomains { id domain targetPort } customDomains { id domain targetPort } } } } pageInfo { hasNextPage } } volumeInstances(first: 100) { edges { node { sizeMB volume { name } } } pageInfo { hasNextPage } } } }",
          "--var",
          `id=${environmentId}`,
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
    const httpPorts = new Map<string, readonly (number | null)[]>();
    for (const { node } of services.edges) {
      if (!Object.hasOwn(knownPorts, node.serviceName))
        throw new Error("Unexpected service in whole-project exposure lookup");
      if (
        typeof node.serviceId !== "string" ||
        !node.serviceId.trim() ||
        !Object.hasOwn(configured, node.serviceId)
      )
        throw new Error("Incomplete service networking lookup");
      const service = configured[node.serviceId];
      if (service.name !== undefined && service.name !== node.serviceName)
        throw new Error("Mismatched service identity");
      const domains = node.domains;
      if (
        ![domains?.serviceDomains, domains?.customDomains].every(Array.isArray)
      )
        throw new Error("Incomplete domain lookup");
      const ports = [...domains.serviceDomains, ...domains.customDomains].map(
        (domain) => {
          if (
            typeof domain?.id !== "string" ||
            !domain.id.trim() ||
            typeof domain.domain !== "string" ||
            !domain.domain.trim() ||
            (domain.targetPort !== null &&
              (!Number.isInteger(domain.targetPort) ||
                domain.targetPort < 1 ||
                domain.targetPort > 65535))
          )
            throw new Error("Invalid domain metadata");
          return domain.targetPort;
        }
      );
      if (ports.length) httpPorts.set(node.serviceName, ports);
      const networking = service.networking;
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
      httpPorts,
    };
  } catch {
    throw new Error(
      "Cannot establish safe existing Railway services, volumes and exposure; refusing to plan database passwords or capacity until networking metadata is complete."
    );
  }
}
