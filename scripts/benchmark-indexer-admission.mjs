import { createServer } from "node:http";
import { setTimeout as pause } from "node:timers/promises";

// Benchmark-only compatibility fixture: the old reader has no capacity recovery.
// Cache hits are forwarded immediately; only explicit capacity errors wait.
export async function queuedAdmission(origin) {
  let active = 0;
  let inFlight = 0;
  let closing;
  const waiting = [];
  const stats = { requests: 0, capacityRetries: 0, exhausted: 0 };
  const acquire = async (deadline) => {
    if (active < 32) active++;
    else {
      if (waiting.length >= 256) throw new Error("queue_full");
      await new Promise((accept, reject) => {
        const resume = () => {
          clearTimeout(timer);
          accept();
        };
        const timer = setTimeout(
          () => {
            waiting.splice(waiting.indexOf(resume), 1);
            reject(new Error("queue_timeout"));
          },
          Math.max(1, deadline - performance.now())
        );
        waiting.push(resume);
      });
    }
    return () => {
      const next = waiting.shift();
      if (next) next();
      else active--;
    };
  };
  const failure = (id) => ({
    jsonrpc: "2.0",
    id,
    error: { code: -32005, message: "Benchmark capacity recovery exhausted" },
  });
  const dispatch = async (path, items, batch) => {
    stats.requests += items.length;
    const results = new Map();
    let pending = items;
    const deadline = performance.now() + 8000;
    for (let attempt = 0; attempt < 64; attempt++) {
      if (performance.now() >= deadline) break;
      const release = await acquire(deadline);
      let response;
      let body;
      try {
        response = await fetch(`${origin}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batch ? pending : pending[0]),
          signal: AbortSignal.timeout(
            Math.max(1, Math.ceil(deadline - performance.now()))
          ),
        });
        body = await response.json();
      } finally {
        release();
      }
      const replies = Array.isArray(body)
        ? body
        : response.status === 429 && batch && body.error
          ? pending.map((item) => ({ ...body, id: item.id }))
          : [body];
      const byId = new Map(replies.map((reply) => [reply.id, reply]));
      if (byId.size !== pending.length) throw new Error("invalid_response_ids");
      const retry = [];
      for (const item of pending) {
        const reply = byId.get(item.id);
        if (!reply) throw new Error("missing_response_id");
        if (Object.hasOwn(reply, "result") === Object.hasOwn(reply, "error"))
          throw new Error("invalid_response_shape");
        const capacity =
          Boolean(reply.error) &&
          reply.error?.code !== 3 &&
          !reply.error?.data &&
          (response.status === 429 ||
            [-32005, -32007, -32016].includes(reply.error?.code));
        if (capacity) retry.push(item);
        else results.set(item.id, reply);
      }
      if (!retry.length) return items.map((item) => results.get(item.id));
      stats.capacityRetries += retry.length;
      pending = retry;
      await pause(
        Math.max(
          0,
          Math.min(25 * 2 ** attempt, 250, deadline - performance.now())
        )
      );
    }
    stats.exhausted += pending.length;
    return items.map((item) => results.get(item.id) ?? failure(item.id));
  };
  const server = createServer(async (request, response) => {
    let count = 0;
    try {
      if (
        request.method !== "POST" ||
        !/^\/pv\/evm\/[0-9]+$/.test(request.url)
      ) {
        response.writeHead(404).end();
        return;
      }
      let text = "";
      for await (const chunk of request) {
        text += chunk;
        if (text.length > 1_048_576) throw new Error("request_too_large");
      }
      const payload = JSON.parse(text);
      const batch = Array.isArray(payload);
      const items = batch ? payload : [payload];
      if (
        !items.length ||
        items.length > 256 ||
        items.some((item) => !["number", "string"].includes(typeof item?.id)) ||
        new Set(items.map((item) => item.id)).size !== items.length ||
        inFlight + items.length > 1024
      )
        throw new Error("invalid_or_excessive_request");
      count = items.length;
      inFlight += count;
      const results = await dispatch(request.url, items, batch);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(batch ? results : results[0]));
    } catch {
      stats.exhausted++;
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify(failure(null)));
    } finally {
      inFlight -= count;
    }
  });
  await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    stats,
    close: () => {
      closing ??= (async () => {
        server.closeIdleConnections();
        await new Promise((accept) => server.close(accept));
        while (inFlight) await pause(10);
      })();
      return closing;
    },
  };
}
