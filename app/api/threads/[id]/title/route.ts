import { db } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { model } from "@/agent/model";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

// Helper function to extract plain text from complex AI SDK message content structures
function getMessageTextContent(content: any): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          if (part.type === "text" && typeof part.text === "string") {
            return part.text;
          }
          if (typeof part.text === "string") {
            return part.text;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: threadId } = await params;
    if (!threadId) {
      return new Response(JSON.stringify({ error: "Bad Request", message: "Missing thread ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const { userId } = await auth();
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      return new Response(JSON.stringify({ error: "Bad Request", message: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const { messages } = body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({
          error: "Bad Request",
          message: "Missing or invalid 'messages' field in request body"
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Verify thread ownership first
    const thread = await db.thread.findFirst({
      where: { id: threadId, userId },
    });
    if (!thread) {
      return new Response(JSON.stringify({ error: "Not Found", message: "Thread not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`[title/route] Creating AI title for thread: ${threadId}`);

    const promptTemplate = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are a title generator. Your ONLY job is to output a chat title.

RULES (follow all of them strictly):
- Output ONLY the title — no explanation, no punctuation at the end, no quotes
- Maximum 4 words, ideally 2-3
- Use a short noun phrase (not a sentence or question)
- Be specific to the topic, not generic
- Never output: "New Chat", "Chat", "Conversation", "Thread", "Discussion"

EXAMPLES:
User asks about fixing a React bug → React Bug Fix
User asks to write a poem about rain → Rain Poem
User asks about Python list comprehensions → Python List Comprehensions
User asks how to lose weight → Weight Loss Tips
User asks to summarize a news article → News Article Summary`
      ],
      [
        "human",
        `Conversation:
{history}

Title:`
      ]
    ]);

    const outputParser = new StringOutputParser();
    const chain = promptTemplate.pipe(model).pipe(outputParser);

    // Format the conversation history with clean text contents and role indicators
    const formattedHistory = messages
      .map((m: any) => {
        const roleName = m.role === "user" ? "User" : "Assistant";
        const text = getMessageTextContent(m.content);
        return `${roleName}: ${text}`;
      })
      .filter((line) => line.trim().length > 0)
      .join("\n\n");

    let title = "New Chat";
    try {
      const result = await chain.invoke({
        history: formattedHistory,
      });
      if (result) {
        title = result
          .trim()
          .replace(/^["'`]|["'`]$/g, "")    // strip surrounding quotes
          .replace(/[.!?]+$/, "")             // strip trailing punctuation
          .replace(/\s+/g, " ")              // collapse whitespace
          .trim();

        // Hard cap: 40 characters max
        if (title.length > 40) {
          title = title.substring(0, 40).trim();
        }
      }
    } catch (aiError) {
      console.error("[title/route] Error running LangChain model:", aiError);
      // Fallback: extract clean text of the first user message and truncate
      const firstMessageText = getMessageTextContent(messages[0]?.content);
      title = firstMessageText.length > 30
        ? firstMessageText.substring(0, 30).trim() + "..."
        : firstMessageText || "New Chat";
    }

    // Save generated title to DB
    await db.thread.update({
      where: { id: threadId, userId },
      data: { title },
    });

    console.log(`[title/route] Successfully saved title: "${title}" for thread: ${threadId}`);

    return Response.json({ title });
  } catch (error) {
    console.error("[POST /api/threads/[id]/title] Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
