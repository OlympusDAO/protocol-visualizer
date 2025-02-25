import { createClient } from '@ponder/client';
import * as schema from "../../../indexer/ponder.schema";

export function createPonderClient() {
  return createClient(`${process.env.NEXT_PUBLIC_PONDER_URL || 'http://localhost:42069'}/sql`, { schema });
}
