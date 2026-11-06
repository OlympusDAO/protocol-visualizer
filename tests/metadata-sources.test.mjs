import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

test("preparation checks Etherscan once per miss, preserves prepared metadata, fills missing ABI and sanitizes failures", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pv-metadata-sources-"));
  const output = path.join(root, "metadata.json"),
    report = path.join(root, "sources.json");
  const preload = path.join(root, "fetch.mjs"),
    requests = path.join(root, "requests.json");
  const address = "0x2cea7b722dbd6b03f0e857d11e53ecb698cc2b4e";
  const canary = "metadata-fixture-private-key";
  const abi = [
    {
      type: "function",
      name: "owner",
      inputs: [],
      outputs: [{ type: "address" }],
      stateMutability: "view",
    },
  ];
  const source = {
    SourceCode:
      "contract Example { function owner() external view returns(address) {} }",
    ABI: JSON.stringify(abi),
    ContractName: "Example",
    Proxy: "1",
    Implementation: `0x${"42".repeat(20)}`,
    SimilarMatch: `0x${"43".repeat(20)}`,
  };
  const previous = {
    roleToFunctions: { admin: ["owner"] },
    functionSelectors: {
      "0x8da5cb5b": {
        name: "owner",
        roles: ["admin"],
        canonicalSignature: "owner()",
        documentation: { notice: "Keep existing verified docs" },
      },
    },
    addressGetters: ["owner"],
  };
  const run = (seed, responses, normal = false, options = {}) => {
    writeFileSync(output, JSON.stringify({ 1: { [address]: seed } }));
    writeFileSync(requests, "[]");
    writeFileSync(
      preload,
      `
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const responses=${JSON.stringify(responses)},calls=[];
if (${Boolean(options.exitBeforeFetch)}) process.exit(0);
globalThis.fetch=async (input)=>{
 const url=new URL(input);calls.push({host:url.hostname,action:url.searchParams.get("action"),address:url.searchParams.get("address")});
 writeFileSync(${JSON.stringify(requests)},JSON.stringify(calls));
 if(url.hostname==="sourcify.dev") return new Response(null,{status:404});
 assert.equal(url.hostname,"api.etherscan.io");assert.equal(url.searchParams.get("action"),"getsourcecode");
 if(!${Boolean(options.multiple)}) assert.equal(url.searchParams.get("address"),${JSON.stringify(address)});
 assert.equal(url.searchParams.get("apikey"),${JSON.stringify(canary)});
 const response=responses.shift();assert.ok(response,"unexpected extra explorer call");
 if(response.throw) throw Error(response.throw);
 if(response.bodyTimeout) return {ok:true,status:200,json:async()=>{throw Object.assign(Error(response.bodyTimeout),{name:"TimeoutError"});}};
 if(response.raw) return new Response(response.raw,{status:response.status??200});
 return Response.json(response.body,{status:response.status??200});
};
`
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        "scripts/generate-indexer-contract-metadata.mjs",
        ...(normal
          ? []
          : [
              options.refreshOnly ? "--refresh-getters" : "--prefetch-metadata",
              "--source-report",
              report,
            ]),
        ...(options.multiple
          ? ["--chain-id", "11155111", "--name", "EmissionManager"]
          : ["--chain-id", "1", "--address", address]),
        "--force",
        "--output",
        output,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ETHERSCAN_API_KEY: options.noKey ? "" : canary,
          ETHERSCAN_MIN_REQUEST_INTERVAL_MS: "1",
          ETHERSCAN_MAX_RETRIES: "3",
          ETHERSCAN_RETRY_BASE_DELAY_MS: "1",
          ETHERSCAN_RATE_LIMIT_DELAY_MS: "1",
        },
      }
    );
    assert.ok(
      !`${result.stdout}${result.stderr}`.includes(canary),
      "credential must never reach logs"
    );
    if (!normal)
      assert.ok(
        !readFileSync(report, "utf8").includes(canary),
        "credential must never reach coverage report"
      );
    return {
      result,
      metadata: JSON.parse(readFileSync(output, "utf8"))[1][address],
      calls: JSON.parse(readFileSync(requests, "utf8")),
      coverage: normal ? undefined : JSON.parse(readFileSync(report, "utf8")),
    };
  };
  try {
    let check = run(previous, [{ body: { status: "1", result: [source] } }]);
    assert.equal(check.result.status, 0, check.result.stderr);
    assert.deepEqual(
      check.metadata,
      previous,
      "explorer fallback must preserve prepared metadata"
    );
    assert.equal(
      check.calls.filter((c) => c.host === "api.etherscan.io").length,
      1
    );
    assert.equal(check.coverage.entries[0].etherscan, "available");
    assert.equal(check.coverage.entries[0].etherscanDeploymentProof, false);

    check = run(previous, [], true, { exitBeforeFetch: true });
    assert.equal(check.result.status, 0);
    assert.deepEqual(
      check.calls,
      [],
      "a child exiting before fetch must not reuse earlier requests"
    );

    check = run({ roleToFunctions: {}, functionSelectors: {} }, [
      { body: { status: "1", result: [source] } },
    ]);
    assert.equal(check.result.status, 0, check.result.stderr);
    assert.equal(
      check.metadata.functionSelectors["0x8da5cb5b"].canonicalSignature,
      "owner()"
    );
    assert.equal(
      check.metadata.functionSelectors["0x8da5cb5b"].documentation,
      undefined
    );
    check = run(previous, [
      {
        body: {
          status: "0",
          message: "NOTOK",
          result: `Max rate limit reached ${canary}`,
        },
      },
      { status: 429, body: { message: canary } },
      { body: { status: "1", result: [source] } },
    ]);
    assert.equal(check.result.status, 0, check.result.stderr);
    assert.equal(
      check.calls.filter((c) => c.host === "api.etherscan.io").length,
      3,
      "bounded retries must recover"
    );
    check = run(previous, [
      { bodyTimeout: `body timeout ${canary}` },
      { body: { status: "1", result: [source] } },
    ]);
    assert.equal(check.result.status, 0, check.result.stderr);
    assert.equal(
      check.calls.filter((c) => c.host === "api.etherscan.io").length,
      2,
      "body timeout must retry without becoming a malformed-response result"
    );
    for (const [response, expected] of [
      [
        {
          status: "1",
          result: [
            {
              ...source,
              SourceCode: "",
              ABI: "Contract source code not verified",
            },
          ],
        },
        "unverified",
      ],
      [
        {
          status: "0",
          message: "NOTOK",
          result: `Missing or unsupported chainid ${canary}`,
        },
        "unsupported-chain",
      ],
      [
        { status: "0", message: "NOTOK", result: `Invalid API Key ${canary}` },
        "authentication-error",
      ],
      [
        {
          status: "0",
          message: "NOTOK",
          result: `Daily rate limit exceeded ${canary}`,
        },
        "daily-quota-exceeded",
      ],
      [null, "invalid-response"],
      [{ status: "unexpected", result: canary }, "invalid-response"],
      [
        { status: "1", result: [{ ...source, ABI: canary }] },
        "invalid-response",
      ],
    ]) {
      check = run(previous, [{ body: response }]);
      assert.notEqual(check.result.status, 0);
      assert.deepEqual(check.metadata, previous);
      assert.equal(check.coverage.entries[0].etherscan, expected);
      assert.equal(
        check.calls.filter((c) => c.host === "api.etherscan.io").length,
        1
      );
    }
    for (const [responses, expected, count] of [
      [[{ raw: `invalid json ${canary}` }], "invalid-response", 1],
      [
        Array.from({ length: 3 }, () => ({ throw: `fetch failed ${canary}` })),
        "network-error",
        3,
      ],
      [
        Array.from({ length: 3 }, () => ({
          status: 429,
          body: { message: canary },
        })),
        "http-429",
        3,
      ],
    ]) {
      check = run(previous, responses);
      assert.notEqual(check.result.status, 0);
      assert.deepEqual(check.metadata, previous);
      assert.equal(check.coverage.entries[0].etherscan, expected);
      assert.equal(
        check.calls.filter((c) => c.host === "api.etherscan.io").length,
        count
      );
    }
    for (const options of [{ noKey: true }, { refreshOnly: true }]) {
      check = run(previous, [], false, options);
      assert.notEqual(check.result.status, 0);
      assert.equal(
        check.calls.filter((c) => c.host === "api.etherscan.io").length,
        0
      );
      assert.equal(
        check.coverage.entries[0].etherscan,
        options.noKey ? "not-configured" : "not-attempted"
      );
    }
    check = run(
      previous,
      [
        {
          body: {
            status: "0",
            message: "NOTOK",
            result: `Invalid API Key ${canary}`,
          },
        },
      ],
      false,
      { multiple: true }
    );
    assert.notEqual(check.result.status, 0);
    assert.ok(check.coverage.entries.length > 1);
    assert.equal(
      check.coverage.entries.filter((e) => e.etherscanAttempted).length,
      1,
      "authentication failure stops further explorer calls in the batch"
    );
    assert.equal(
      check.calls.filter((c) => c.host === "api.etherscan.io").length,
      1
    );
    check = run({}, [{ body: { status: "1", result: [source] } }], true);
    assert.equal(check.result.status, 0, check.result.stderr);
    assert.equal(
      check.calls.length,
      1,
      "ordinary preparation must use ABI and source from one response"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
