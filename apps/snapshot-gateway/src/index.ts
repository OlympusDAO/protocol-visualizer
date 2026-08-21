import { createServer } from "node:http";
import {
  createSnapshotGateway,
  getSafeErrorDetails,
  loadGatewayConfig,
} from "./server.js";

const logFatalError = (event: string, error: unknown) => {
  console.error(
    "snapshot gateway failed",
    JSON.stringify({ event, ...getSafeErrorDetails(error) })
  );
};

const main = async () => {
  const config = await loadGatewayConfig();
  const port = Number(process.env.PORT || "8080");

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT must be a positive integer`);
  }

  const server = createServer(createSnapshotGateway(config));
  server.once("error", (error) => {
    logFatalError("snapshot_gateway_server_error", error);
    process.exit(1);
  });
  server.listen(port, "::", () => {
    console.log(`snapshot gateway listening on port ${port}`);
  });
};

main().catch((error) => {
  logFatalError("snapshot_gateway_startup_failed", error);
  process.exitCode = 1;
});
