// app/api/threads/[id]/messages/route.ts
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) {
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

    const thread = await db.thread.findFirst({
      where: { id, userId },
    });
    if (!thread) {
      return new Response(JSON.stringify({ error: "Not Found", message: "Thread not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    const messages = await db.message.findMany({
      where: { threadId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, parentId: true, format: true, content: true },
    });

    return Response.json(messages);
  } catch (error) {
    console.error("[GET /api/threads/[id]/messages] Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
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

    const thread = await db.thread.findFirst({
      where: { id: threadId, userId },
    });
    if (!thread) {
      return new Response(JSON.stringify({ error: "Not Found", message: "Thread not found" }), {
        status: 404,
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

    const { id, parentId, format, content } = body;

    // Basic request body validation
    if (!id || !format || !content) {
      return new Response(
        JSON.stringify({ 
          error: "Bad Request", 
          message: "Missing required fields (id, format, content)" 
        }), 
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    let finalParentId = parentId;
    if (!finalParentId) {
      // If no parentId is provided, fallback to linking to the latest message in this thread
      const lastMessage = await db.message.findFirst({
        where: { threadId },
        orderBy: { createdAt: "desc" },
      });
      finalParentId = lastMessage?.id ?? null;
    }

    const savedMessage = await db.message.upsert({
      where: { id },
      create: {
        id,
        threadId,
        parentId: finalParentId,
        format,
        content,
      },
      update: { content },
    });

    return Response.json({ ok: true, message: savedMessage });
  } catch (error) {
    console.error("[POST /api/threads/[id]/messages] Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
