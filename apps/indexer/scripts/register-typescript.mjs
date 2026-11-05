import "./typescript-loader.mjs";

// Reader fixtures use synthetic runtimes. Source-discovery tests replace this
// response explicitly; ordinary unit/benchmark runs never depend on live metadata.
const fixtureFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin === "https://sourcify.dev")
    return Promise.resolve(new Response("{}", { status: 404 }));
  return fixtureFetch(input, options);
};
