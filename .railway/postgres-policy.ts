import { execFileSync } from "node:child_process";
import { preserve, type RailwayContext, type VariableValue } from "railway/iac";

export const postgresPasswordGenerator =
  '${{ secret(64, "0123456789abcdef") }}';

export function postgresPassword(
  name: string,
  existingServices: ReadonlySet<string> | undefined
): VariableValue {
  // Offline typechecks cannot establish that a database is new. Fail closed.
  return existingServices === undefined || existingServices.has(name)
    ? preserve()
    : { type: "raw", value: { defaultValue: postgresPasswordGenerator } };
}

export function existingResources(ctx: RailwayContext):
  | {
      serviceNames: ReadonlySet<string>;
      volumeSizes: ReadonlyMap<string, number>;
    }
  | undefined {
  if (!ctx.environmentId) return undefined;
  try {
    const result = JSON.parse(
      execFileSync(
        "railway",
        [
          "api",
          "query($id: String!) { environment(id: $id) { serviceInstances(first: 100) { edges { node { serviceName } } pageInfo { hasNextPage } } volumeInstances(first: 100) { edges { node { sizeMB volume { name } } } pageInfo { hasNextPage } } } }",
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
    return {
      serviceNames: new Set(
        services.edges.map(
          (edge: { node: { serviceName: string } }) => edge.node.serviceName
        )
      ),
      volumeSizes,
    };
  } catch {
    throw new Error(
      "Cannot establish existing Railway services and volumes; refusing to plan database passwords or capacity."
    );
  }
}
