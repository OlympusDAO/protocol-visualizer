import { createClient } from "@ponder/client";
import * as schema from "../../../indexer/ponder.schema";

const client = createClient(
  `${import.meta.env.VITE_PONDER_URL || "http://localhost:42069"}/sql`,
  { schema }
);

export { client, schema };
