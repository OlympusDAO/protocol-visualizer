import { createServer } from "node:http";
import { loadGatewayConfig, createSnapshotGateway } from "./server.js";

const config = await loadGatewayConfig();
const port = Number(process.env.PORT || "8080");

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`PORT must be a positive integer`);
}

const server = createServer(createSnapshotGateway(config));
server.listen(port, "::", () => {
  console.log(`snapshot gateway listening on port ${port}`);
});
