// Native provider reporting; inventory is evaluated once, offline.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeImageInventory } from "./runtime-image-inventory.mjs";
import { runRecorded } from "./validation-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || (args.length && args[0] !== "--provider"))
  throw new Error("Usage: scan-runtime-images.mjs [--provider]");
const provider = args[0] === "--provider";
if (provider && process.env.PV_VALIDATION_CHILD !== "provider") {
  process.exitCode = await runRecorded("provider", process.execPath, [
    fileURLToPath(import.meta.url),
    "--provider",
  ]);
} else {
  await scanImages();
}

async function scanImages() {
  const images = await runtimeImageInventory();
  for (const image of images)
    console.log(
      `${image.kind === "provider" ? (provider ? "advisory-provider" : "advisory-provider/not-run") : image.kind === "local" ? "excluded-local" : "owned"}: ${image.reference} (${image.origins.join(", ")}) ${image.resources.join(", ")} ${image.reason ?? ""}`
    );
  const selected = images.filter(
    (image) => image.kind === (provider ? "provider" : "owned")
  );
  if (provider && !selected.length)
    throw new Error("No configured advisory-provider PostgreSQL images found.");
  for (const { reference } of selected) {
    console.log(
      `${provider ? "Provider advisory report" : "Required external scan"}: ${reference}, linux/amd64`
    );
    const result = spawnSync(
      "trivy",
      [
        "image",
        "--format",
        "table",
        "--image-src",
        "remote",
        "--platform",
        "linux/amd64",
        "--cache-dir",
        path.join(root, "node_modules/.cache/container-scan/trivy"),
        "--scanners",
        provider ? "vuln" : "vuln,secret",
        "--ignore-unfixed=false",
        "--severity",
        "MEDIUM,HIGH,CRITICAL",
        "--ignorefile",
        path.join(root, ".trivyignore"),
        "--exit-code",
        provider ? "0" : "1",
        reference,
      ],
      { cwd: root, stdio: "inherit" }
    );
    if (result.error) console.error(`Cannot start Trivy: ${result.error.code}`);
    if (result.status !== 0) {
      process.exitCode = result.status || 1;
      break;
    }
  }
}
