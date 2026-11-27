// Exercise the pinned Envio loader, cache identity and limiter; only storage is adapted.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const envio = pathToFileURL(require.resolve("envio"));
const [UserContext, LoadManager, EffectState, RunScope, Clock] =
  await Promise.all(
    ["UserContext", "LoadManager", "EffectState", "RunScope", "Clock"].map(
      (name) => import(new URL(`./src/${name}.res.mjs`, envio))
    )
  );

export async function makeEffectRuntime({
  rows = new Map(),
  readRows = async (table, ids) =>
    ids.flatMap((id) => {
      const row = rows.get(`${table}:${id}`);
      return row ? [row] : [];
    }),
  writeRows = async (table, values) => {
    for (const row of values) rows.set(`${table}:${row.id}`, row);
  },
} = {}) {
  const config = {
    defaultCrossChain: true,
    checkpointSequence: "SharedAcrossChains",
    ecosystem: {},
    userEntitiesByName: {},
  };
  const state = {
    config,
    clock: Clock.real,
    effectState: EffectState.make(Clock.real),
    committedFrontier: { 1: 0n },
    storageLoadStats: {},
    storedEffectCaches: new Proxy({}, { has: () => true }),
    storage: {
      name: "fixture",
      loadOrThrow: (filter, table) => readRows(table.tableName, filter.id._in),
    },
  };
  const loadManager = LoadManager.make();
  const context = UserContext.makeHandlerContext({
    config,
    loadManager,
    indexerState: state,
  });
  return {
    state,
    rows,
    effect(effect, input, chainId = 1) {
      return RunScope.enter(
        {
          TAG: "Handler",
          _0: {
            checkpointId: 1n,
            isPreload: true,
            item: { kind: 0, chainId },
          },
        },
        () => context.effect(effect, input)
      );
    },
    async flush() {
      for (const table of Object.values(state.effectState.tables)) {
        const values = table.idsToStore.map((id) => ({
          id,
          output: JSON.parse(JSON.stringify(table.dict[id].output)),
        }));
        if (values.length) await writeRows(table.table.tableName, values);
        table.idsToStore.length = 0;
      }
    },
  };
}
