import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

export async function GET(
  request: Request,
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

    return Response.json(thread);
  } catch (error) {
    console.error(`[GET /api/threads/[id]] Error fetching thread:`, error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function PATCH(
  request: Request,
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
      body = await request.json();
    } catch (parseError) {
      return new Response(JSON.stringify({ error: "Bad Request", message: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const updatedThread = await db.thread.update({
      where: { id: threadId },
      data: {
        title: body.title !== undefined ? body.title : undefined,
      },
    });

    return Response.json(updatedThread);
  } catch (error) {
    console.error(`[PATCH /api/threads/[id]] Error updating thread:`, error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function DELETE(
  request: Request,
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

    await db.thread.delete({ where: { id: threadId } });
    return Response.json({ success: true, message: "Thread deleted" });
  } catch (error) {
    console.error(`[DELETE /api/threads/[id]] Error deleting thread:`, error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
