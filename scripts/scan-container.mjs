import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const services = [
  "frontend",
  "hasura",
  "indexer",
  "rpc-cache",
  "snapshot-gateway",
  "snapshot-publisher",
  "snapshot-monitor",
];
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const [service, image = `protocol-visualizer/${service}:local`] = args;
if (!services.includes(service) || args.length > 2) {
  console.error("Usage: pnpm run container:scan -- <service> [local-image]");
  process.exit(1);
}

const cache = path.join(root, "node_modules/.cache/container-scan");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(path.join(cache, "run-"));
const env = {
  ...process.env,
  TMPDIR: directory,
  TMP: directory,
  TEMP: directory,
};
const run = (command, parameters, capture = false) => {
  const result = spawnSync(command, parameters, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error || result.signal || result.status !== 0) {
    process.exitCode = result.status || 1;
    throw new Error(
      `Command failed: ${command} (${result.error?.code ?? result.signal ?? result.status})`
    );
  }
  return result.stdout?.trim();
};
const container = (...parameters) =>
  run(
    process.execPath,
    [path.join(root, "scripts/container.mjs"), ...parameters],
    true
  );

try {
  const id = container("image", "inspect", image, "--format", "{{.Id}}");
  if (!/^(sha256:)?[0-9a-f]{64}$/.test(id ?? ""))
    throw new Error(
      "The container engine did not return an immutable image ID"
    );
  console.log(`Scanning ${service}: ${id}`);
  const archive = path.join(directory, "image.tar");
  container("save", "--output", archive, id);
  run("trivy", [
    "image",
    "--input",
    archive,
    "--cache-dir",
    path.join(cache, "trivy"),
    "--scanners",
    "vuln",
    "--severity",
    "MEDIUM,HIGH,CRITICAL",
    "--ignorefile",
    path.join(root, ".trivyignore"),
    "--exit-code",
    "1",
    ...(service === "hasura" ? ["--ignore-unfixed"] : []),
  ]);
} catch (error) {
  console.error(error.message);
  process.exitCode ||= 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
