import { spawnSync } from "node:child_process";

const requested = process.env.CONTAINER_ENGINE;
if (requested && !["docker", "podman"].includes(requested)) {
  console.error("CONTAINER_ENGINE must be docker or podman");
  process.exit(1);
}

for (const engine of requested ? [requested] : ["docker", "podman"]) {
  const result = spawnSync(engine, process.argv.slice(2), { stdio: "inherit" });
  if (result.error?.code === "ENOENT" && !requested) continue;
  if (result.error) {
    console.error(`Could not run ${engine}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) process.kill(process.pid, result.signal);
  process.exit(result.status ?? 1);
}

console.error("Install Docker or Podman, or set CONTAINER_ENGINE explicitly");
process.exit(1);
