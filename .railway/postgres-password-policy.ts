import { execFileSync } from "node:child_process";
import { preserve, type RailwayContext, type VariableValue } from "railway/iac";

export const postgresPasswordGenerator = 'secret(64, "0123456789abcdef")';

export function postgresPassword(
  name: string,
  existingServices: ReadonlySet<string> | undefined
): VariableValue {
  // Offline typechecks cannot establish that a database is new. Fail closed.
  return existingServices === undefined || existingServices.has(name)
    ? preserve()
    : { type: "raw", value: { generator: postgresPasswordGenerator } };
}

export function existingServiceNames(
  ctx: RailwayContext
): ReadonlySet<string> | undefined {
  if (!ctx.environmentId) return undefined;
  try {
    const result = JSON.parse(
      execFileSync(
        "railway",
        [
          "api",
          "query($id: String!) { environment(id: $id) { serviceInstances(first: 100) { edges { node { serviceName } } pageInfo { hasNextPage } } } }",
          "--var",
          `id=${ctx.environmentId}`,
          "--compact",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }
      )
    );
    const services = result.data?.environment?.serviceInstances;
    if (
      result.errors?.length ||
      !Array.isArray(services?.edges) ||
      services.pageInfo?.hasNextPage !== false ||
      services.edges.some(
        (edge: { node?: { serviceName?: unknown } }) =>
          typeof edge.node?.serviceName !== "string" ||
          !edge.node.serviceName.trim()
      )
    )
      throw new Error("Incomplete service lookup");
    return new Set(
      services.edges.map(
        (edge: { node: { serviceName: string } }) => edge.node.serviceName
      )
    );
  } catch {
    throw new Error(
      "Cannot establish existing Railway services; refusing to plan database password generation."
    );
  }
}
