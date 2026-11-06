import { createHash } from "node:crypto";
import { chmodSync, unlinkSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const indexerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const socketPath = `/tmp/pv-envio-${createHash("sha256").update(indexerDir).digest("hex").slice(0, 12)}.sock`;

// Local-only control: filesystem permissions limit resets to the indexer user.
// The normal HTTP listener never exposes this operation.
export async function startResetServer(reset) {
  let resetting = false;
  const server = createServer((socket) => {
    socket.on("error", () => {});
    const send = (message) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
    };
    const lines = createInterface({ input: socket });
    lines.once("line", async (command) => {
      lines.close();
      if (command !== "reset" || resetting) {
        send({
          log: "Reset rejected: invalid request or reset already in progress.\n",
          code: 1,
        });
        socket.end();
        return;
      }
      resetting = true;
      try {
        const code = await reset((log) => send({ log }));
        send({ code });
      } catch (error) {
        console.error(`Reset failed: ${error.message}`);
        send({
          log: `Reset failed: ${error.message}. Inspect the indexer logs; do not retry automatically.\n`,
          code: 1,
        });
      }
      resetting = false;
      socket.end();
    });
  });
  const listen = () =>
    new Promise((accept, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.removeListener("error", reject);
        chmodSync(socketPath, 0o600);
        accept();
      });
    });
  try {
    await listen();
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    // A crash can leave the socket file behind. Never unlink a live server.
    await new Promise((accept, reject) => {
      const probe = createConnection(socketPath);
      probe.once("connect", () => {
        probe.destroy();
        reject(new Error("An indexer reset control server is already running"));
      });
      probe.once("error", (error) =>
        error.code === "ECONNREFUSED" ? accept() : reject(error)
      );
    });
    unlinkSync(socketPath);
    await listen();
  }
  return server;
}

async function requestReset() {
  const socket = createConnection(socketPath);
  const lines = createInterface({ input: socket });
  let code;
  socket.once("connect", () => socket.write("reset\n"));
  socket.once("error", () => {
    console.error(
      "Cannot reach the indexer reset control socket. The indexer must use the updated start-envio wrapper."
    );
    lines.close();
  });
  for await (const line of lines) {
    const message = JSON.parse(line);
    if (message.log) process.stdout.write(message.log);
    if (Number.isInteger(message.code)) code = message.code;
  }
  socket.destroy();
  if (code === undefined) {
    console.error(
      "Reset completion was not confirmed. Inspect the indexer logs before retrying."
    );
    return 1;
  }
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await requestReset();
}
