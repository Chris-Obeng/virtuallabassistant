import { createAgent, tool } from "langchain";
import { model } from "./model";
import { logToolCallMiddleware } from "./agentMiddleware";
import { webSearchTool } from "./tools";
import { z } from "zod";

const researchSubAgent = createAgent({
  model,
  tools: [webSearchTool],
  systemPrompt:
    `You are a senior research analyst with access to the 'internet_search' tool.

Current date: ${new Date().toISOString()}

Research standards:
- Use internet_search for current, external, niche, or source-sensitive claims.
- Prefer primary sources, official documentation, original announcements, reputable publications, and pages with clear dates.
- Run multiple focused searches when the question has multiple parts or when one source is not enough.
- Compare sources and resolve conflicts by prioritizing authority, recency, and directness.
- Do not fabricate citations, dates, or quotes.
- Return a concise synthesis in Markdown with the key findings, important caveats, and source links.
- If evidence is weak or search fails, say exactly what could and could not be verified.`,
  middleware: [logToolCallMiddleware],
});

export const researchSubAgentTool = tool(
  async ({ query }: { query: string }) => {
    const result = await researchSubAgent.invoke({
      messages: [
        {
          role: "human",
          content: query,
        },
      ],
    });
    return result.messages.at(-1)?.text;
  },
  {
    name: "research_agent",
    description:
      "Delegates deep web research to a senior researcher with internet_search access. " +
      "Use this for multi-source research, source comparison, current facts, or report-quality synthesis. " +
      "Provide a complete research question, scope, and desired output format.",
    schema: z.object({
      query: z
        .string()
        .describe("Complete research task, including scope and desired output."),
    }),
  },
);
