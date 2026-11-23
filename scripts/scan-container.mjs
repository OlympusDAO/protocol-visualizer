import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ownedImages, runContainer } from "./container.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const [service] = args;
if (!ownedImages.includes(service) || args.length !== 1) {
  console.error("Usage: pnpm run docker:scan -- <service>");
  process.exit(1);
}
const image = `protocol-visualizer/${service}:local`;
function run(command, parameters) {
  const result = spawnSync(command, parameters, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error || result.signal || result.status !== 0) {
    process.exitCode = result.status || 1;
    throw new Error(
      `Command failed: ${command} (${result.error?.code ?? result.signal ?? result.status})`
    );
  }
}
try {
  // Owned images must exist locally; Trivy cannot fall back to a registry pull.
  const engine = runContainer([
    "image",
    "inspect",
    image,
    "--format",
    "{{.RepoTags}}",
  ]);
  run("trivy", [
    "image",
    "--image-src",
    engine,
    "--format",
    "table",
    "--cache-dir",
    path.join(root, "node_modules/.cache/container-scan/trivy"),
    "--scanners",
    "vuln,secret",
    "--image-config-scanners",
    "secret",
    "--severity",
    "MEDIUM,HIGH,CRITICAL",
    "--ignorefile",
    path.join(root, ".trivyignore"),
    "--exit-code",
    "1",
    `--ignore-unfixed=${["hasura", "indexer"].includes(service)}`,
    image,
  ]);
} catch (error) {
  console.error(error.message);
  process.exitCode ||= error.status || 1;
}
