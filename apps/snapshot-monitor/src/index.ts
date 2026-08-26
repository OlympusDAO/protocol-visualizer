import { runMonitorFromEnv } from "./monitor.js";

runMonitorFromEnv().catch(() => {
  process.exitCode = 1;
});
