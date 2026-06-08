import { evaluateRailwayFile, validateGraph } from "railway/iac";

const result = await evaluateRailwayFile(".railway/railway.ts", {
  context: {
    environment: "local",
    environmentName: "local",
  },
});
const errors = validateGraph(result.graph);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

const services = Object.keys(result.desiredConfig.services ?? {});
const buckets = Object.keys(result.desiredConfig.buckets ?? {});

console.log(
  JSON.stringify(
    {
      ok: true,
      project: result.graph.project.name,
      services,
      buckets,
    },
    null,
    2
  )
);
