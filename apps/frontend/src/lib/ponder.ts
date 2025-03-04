import { createClient } from "@ponder/client";
import * as schema from "../../../indexer/ponder.schema";

if (!import.meta.env.VITE_PONDER_URL && import.meta.env.PROD) {
  throw new Error("VITE_PONDER_URL is not set");
}

const client = createClient(
  `${import.meta.env.VITE_PONDER_URL || "http://localhost:42069"}/sql`,
  { schema }
);

export { client, schema };
