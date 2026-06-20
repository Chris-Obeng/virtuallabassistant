import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const DIRECT_URL = process.env.DIRECT_URL;

// long term memory
export const store = PostgresStore.fromConnString(DIRECT_URL!);

// short term momory
export const checkpointer = PostgresSaver.fromConnString(DIRECT_URL!);

if (DIRECT_URL) {
  await store.setup();
  await checkpointer.setup();
}
