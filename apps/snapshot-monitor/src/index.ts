import { loadConfiguredChains, runMonitorFromEnv } from "./monitor.js";

const checkConfigOnly = process.argv.includes("--check-config");
const run = checkConfigOnly ? loadConfiguredChains() : runMonitorFromEnv();
run.catch((error) => {
  if (checkConfigOnly)
    console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
