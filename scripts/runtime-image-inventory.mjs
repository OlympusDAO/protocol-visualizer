// Evaluate the existing SDK definition offline; never supply an environmentId.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRailwayContext } from "railway/iac";
import defineInfrastructure from "../.railway/railway.ts";
import { ownedImages } from "./container.mjs";

const requireFromFrontend = createRequire(
  new URL("../apps/frontend/package.json", import.meta.url)
);
const { parse } = createRequire(
  requireFromFrontend.resolve("vite/package.json")
)("yaml");

export const localImageSkipReason =
  "Local development/test fixture, not deployed by Railway IaC, excluded by explicit user policy.";
export const providerImageReason =
  "Upstream maintains image contents; repository selects the pinned tag/digest; findings reviewed separately, not treated as owned-app failures.";
const root = fileURLToPath(new URL("../", import.meta.url));

export function imageInventory(resources, compose) {
  const images = new Map();
  function add(reference, origin, kind, resource) {
    if (typeof reference !== "string" || !reference.trim())
      throw new Error("Missing runtime image reference");
    const row = images.get(reference) ?? {
      reference,
      origins: [],
      resources: [],
      kind,
    };
    if (!row.origins.includes(origin)) row.origins.push(origin);
    if (resource) row.resources.push(resource);
    if (kind === "owned" || row.kind === "local") row.kind = kind;
    images.set(reference, row);
  }
  for (const resource of resources) {
    if (["group", "volume", "bucket"].includes(resource.type)) continue;
    if (!["service", "database"].includes(resource.type))
      throw new Error("Unsupported runtime resource");
    const source = resource.source;
    if (source?.type === "github") {
      if (
        resource.type !== "service" ||
        !ownedImages.includes(resource.name) ||
        source.repo !== "OlympusDAO/protocol-visualizer" ||
        resource.build?.dockerfilePath !== `Dockerfile-${resource.name}`
      )
        throw new Error("Repository service is missing an owned image build");
    } else if (source?.type === "image") {
      const provider =
        resource.type === "database" &&
        resource.engine === "postgres" &&
        /^ghcr\.io\/railwayapp-templates\/postgres-ssl(?::[\w.-]+(?:@sha256:[a-f0-9]{64})?|@sha256:[a-f0-9]{64})$/.test(
          source.image
        );
      add(
        source.image,
        ".railway/railway.ts",
        provider ? "provider" : "owned",
        resource.name
      );
    } else throw new Error("Unsupported runtime image source");
  }
  const services = parse(compose, { merge: true })?.services ?? {};
  for (const service of Object.values(services))
    if (service?.image !== undefined)
      add(service.image, "docker-compose.yml", "local");
  return [...images.values()].map((row) => ({
    ...row,
    ...(row.kind !== "owned"
      ? {
          reason:
            row.kind === "provider"
              ? providerImageReason
              : localImageSkipReason,
        }
      : {}),
  }));
}

export async function runtimeImageInventory(environment = "production") {
  const definition = await defineInfrastructure(
    createRailwayContext({ environment })
  );
  return imageInventory(
    definition.resources.flat(),
    readFileSync(path.join(root, "docker-compose.yml"), "utf8")
  );
}
