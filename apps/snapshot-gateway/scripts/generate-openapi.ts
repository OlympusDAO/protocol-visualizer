import { readFile, writeFile } from "node:fs/promises";
import { createOpenApiDocument } from "@protocol-visualizer/snapshot-artifacts";

const outputPath = new URL("../../openapi.json", import.meta.url);
const body = `${JSON.stringify(createOpenApiDocument(), null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== body) {
    console.error("apps/snapshot-gateway/openapi.json is stale");
    process.exit(1);
  }
} else {
  await writeFile(outputPath, body);
}
