import { toBaseMessages, toUIMessageStream } from "@ai-sdk/langchain";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { agent } from "@/agent/deepAgent";
import { injectQuoteContext } from "@assistant-ui/react-ai-sdk";
import dotenv from "dotenv";
import { auth } from "@clerk/nextjs/server";

dotenv.config();

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      return new Response(JSON.stringify({ error: "Bad Request", message: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const { messages, id: threadId }: { messages: UIMessage[]; id: string } = body;

    if (!messages || !Array.isArray(messages) || !threadId) {
      return new Response(
        JSON.stringify({ 
          error: "Bad Request", 
          message: "Missing required fields (messages, id)" 
        }), 
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    console.log(`[POST /api/agent] Streaming agent events for thread: ${threadId}`);

    const config = {
      configurable: { thread_id: threadId, userId },
      context: { userId },
    };

    const streamEvents = agent.streamEvents(
      {
        messages: await toBaseMessages(injectQuoteContext(messages)),
      },
      config,
    );

    return createUIMessageStreamResponse({
      stream: toUIMessageStream(streamEvents),
    });
  } catch (error) {
    console.error("[POST /api/agent] Agent streaming failed with error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error", message: (error as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
