import { readFile, writeFile } from "node:fs/promises";
import { createOpenApiDocument } from "@protocol-visualizer/snapshot-artifacts";

const outputPath = new URL("../../openapi.json", import.meta.url);
const document = createOpenApiDocument();
const body = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (
    JSON.stringify(JSON.parse(current || "null")) !== JSON.stringify(document)
  ) {
    console.error("apps/snapshot-gateway/openapi.json is stale");
    process.exit(1);
  }
} else {
  await writeFile(outputPath, body);
}
