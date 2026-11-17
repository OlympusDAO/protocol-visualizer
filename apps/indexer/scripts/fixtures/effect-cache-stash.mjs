import assert from "node:assert/strict";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.env.RESET_FIXTURE_ROOT;
assert(root, "Missing reset fixture root");
const operation = process.argv[2];
assert(
  !existsSync(join(root, "running")) &&
    !existsSync(join(root, "worker-running")),
  `Effect cache ${operation} ran while ingestion was running`
);
assert.equal(
  existsSync(join(root, "migrated")),
  operation === "restore",
  `Effect cache ${operation} ran on the wrong side of the migration`
);
appendFileSync(join(root, "effect-cache"), `${operation}\n`);
process.exit(
  Number(
    operation === "stash"
      ? process.env.RESET_FIXTURE_STASH_CODE
      : process.env.RESET_FIXTURE_RESTORE_CODE
  )
);
