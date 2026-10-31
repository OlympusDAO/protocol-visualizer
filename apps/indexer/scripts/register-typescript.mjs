import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";

// Reader fixtures use synthetic runtimes. Source-discovery tests replace this
// response explicitly; ordinary unit/benchmark runs never depend on live metadata.
const fixtureFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin === "https://sourcify.dev")
    return Promise.resolve(new Response("{}", { status: 404 }));
  return fixtureFetch(input, options);
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) {
        throw error;
      }
      return nextResolve(`${specifier}.ts`, context);
    }
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) {
      return {
        format: "module",
        source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), {
          mode: "transform",
          sourceUrl: url,
        }),
        shortCircuit: true,
      };
    }
    if (url.endsWith(".json") && !url.includes("/node_modules/")) {
      return {
        format: "module",
        source: `export default ${readFileSync(new URL(url), "utf8")}`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
