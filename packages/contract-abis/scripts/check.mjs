import { join } from "node:path";
import { checkRegistry } from "../src/check.mjs";
import {
  abisDir,
  configPath,
  listAbiFiles,
  MANIFEST,
  readJson,
  readJsonIfExists,
} from "../src/files.mjs";

const problems = await checkRegistry({
  manifest: await readJsonIfExists(join(abisDir, MANIFEST)),
  files: await listAbiFiles(),
  readAbi: (file) => readJsonIfExists(join(abisDir, file)),
  config: await readJson(configPath),
});

if (problems.length > 0) {
  console.error(
    `The ABI registry is not consistent. Run 'pnpm abis:sync' and commit the result.\n- ${problems.join("\n- ")}`
  );
  process.exit(1);
}
console.log("The ABI registry is consistent.");
