import { setTimeout } from "node:timers/promises";

const turns = new Map<string, Promise<void>>();
const lastStart = new Map<string, number>();

/** Envio 3.14 runs at most four native workers; reserve one request/s per worker. */
export function waitForMetadata(service: "etherscan" | "sourcify") {
  const worker = process.channel && process.env.ENVIO_INTERNAL_WORKER;
  const interval = worker ? 1000 : 200;
  const turn = (turns.get(service) ?? Promise.resolve()).then(async () => {
    const previous = lastStart.get(service);
    const delay =
      previous === undefined ? 0 : previous + interval - performance.now();
    if (delay > 0) await setTimeout(delay);
    lastStart.set(service, performance.now());
  });
  turns.set(service, turn);
  return turn;
}
