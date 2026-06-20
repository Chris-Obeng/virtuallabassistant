import { model } from "@/agent/model";
import { systemPrompt } from "@/agent/systemPrompt";
import { agentMiddlewares } from "@/agent/agentMiddleware";
import { researchSubAgentTool } from "@/agent/researchSubgent";
import { webSearchTool, webFetchTool } from "./tools";
import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
  StoreBackend,
} from "deepagents";
import * as z from "zod";
import { checkpointer, store } from "./memory";

const contextSchema = z.object({
  userId: z.string(),
});

export const agent = createDeepAgent({
  name: "aurelia",
  model,
  systemPrompt,
  tools: [researchSubAgentTool, webSearchTool, webFetchTool],
  middleware: agentMiddlewares,
  backend: new CompositeBackend(new StateBackend(), {
    // persistent memory
    "/memories/": new StoreBackend({
      namespace: (rt: any) => {
        const userId = rt.config?.configurable?.userId;
        return ["memories", userId];
      },
    }),
  }),
  contextSchema,
  checkpointer,
  store,
  memory: ["memories"],
});
