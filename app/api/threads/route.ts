import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { generateId } from "ai";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const rows = await db.thread.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, updatedAt: true, createdAt: true },
    });
    return Response.json(rows);
  } catch (error) {
    console.error("[GET /api/threads] Error fetching threads:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const id = generateId();
    await db.thread.create({
      data: {
        id,
        userId,
      },
    });
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/threads] Error creating thread:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
