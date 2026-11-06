import { setTimeout } from "node:timers/promises";

const turns = new Map<string, Promise<void>>();
const lastStart = new Map<string, number>();

/** Four native workers share five slots; the unique Ethereum worker gets two. */
export function waitForMetadata(service: "etherscan" | "sourcify") {
  const worker = process.channel && process.env.ENVIO_INTERNAL_WORKER;
  let interval = worker ? 1000 : 200;
  if (worker) {
    try {
      const { chainIds } = JSON.parse(worker);
      if (
        Array.isArray(chainIds) &&
        chainIds.every(Number.isSafeInteger) &&
        chainIds.includes(1)
      )
        interval = 500;
    } catch {
      // Unrecognized worker metadata keeps the conservative one-slot share.
    }
  }
  const turn = (turns.get(service) ?? Promise.resolve()).then(async () => {
    const previous = lastStart.get(service);
    if (previous !== undefined) {
      let delay = previous + interval - performance.now();
      while (delay > 0) {
        await setTimeout(Math.ceil(delay));
        delay = previous + interval - performance.now();
      }
    }
    lastStart.set(service, performance.now());
  });
  turns.set(service, turn);
  return turn;
}
