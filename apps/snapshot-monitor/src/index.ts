import { runMonitorFromEnv } from "./monitor.js";

runMonitorFromEnv().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
