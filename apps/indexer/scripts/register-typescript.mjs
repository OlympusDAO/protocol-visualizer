import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";

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
    if (url.endsWith(".json")) {
      return {
        format: "module",
        source: `export default ${readFileSync(new URL(url), "utf8")}`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
