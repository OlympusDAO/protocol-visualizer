import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const ownedImages = [
  "rpc-cache",
  "indexer",
  "indexer-monitor",
  "frontend",
  "hasura",
  "snapshot-gateway",
  "snapshot-publisher",
  "snapshot-monitor",
];

export function runContainer(args) {
  const requested = process.env.CONTAINER_ENGINE;
  if (requested && !["docker", "podman"].includes(requested))
    throw new Error("CONTAINER_ENGINE must be docker or podman");
  for (const engine of requested ? [requested] : ["docker", "podman"]) {
    const result = spawnSync(engine, args, { stdio: "inherit" });
    if (result.error?.code === "ENOENT" && !requested) continue;
    if (result.error)
      throw new Error(`Could not run ${engine}: ${result.error.message}`);
    if (result.signal) process.kill(process.pid, result.signal);
    if (result.status !== 0) {
      const error = new Error(`${engine} command failed (${result.status})`);
      error.status = result.status ?? 1;
      throw error;
    }
    return engine;
  }
  throw new Error(
    "Install Docker or Podman, or set CONTAINER_ENGINE explicitly"
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    runContainer(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = error.status || 1;
  }
}
