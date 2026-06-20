# Production AI Chat Cookbook
### Next.js · Deep Agents · assistant-ui · Clerk · Prisma · Neon · UploadThing

---

## Tech Stack Decisions

**Storage: UploadThing over Cloudinary / Cloudflare R2**
UploadThing is purpose-built for Next.js. Unlike R2 (which requires presign routes, S3 clients, CORS headers, and ACL policies) or Cloudinary (a media transformation platform you don't need), UploadThing gives you a type-safe file router that lives directly in your Next.js API. Authentication happens in a `middleware` function you already understand. Single `UPLOADTHING_TOKEN` env var, full TypeScript types across the client/server boundary.

**Agent: `createDeepAgent` over `createAgent`**
`createDeepAgent` includes built-in middleware for planning (TodoList), context management (Summarization), a virtual filesystem (Filesystem), and subagent delegation. The summarization middleware automatically handles context window overflow — no custom `preModelHook` needed. `createDeepAgent` returns a compiled LangGraph graph, so checkpointers, streaming, and Studio all work identically.

**Auth: Clerk (already integrated)**
The only backend work needed is Clerk middleware protecting your routes.

---

## Memory Architecture — The Full Picture

Before writing code, understand the two completely separate memory systems LangGraph provides. Confusing them is the most common mistake.

```
┌─────────────────────────────────────────────────────────────────┐
│  SHORT-TERM MEMORY  (PostgresSaver / Checkpointer)              │
│                                                                  │
│  • Stores the full conversation state for ONE thread            │
│  • Scoped to thread_id — each conversation is independent       │
│  • Loaded automatically on every agent call                     │
│  • Gives the model: "what happened in this conversation so far" │
│  • Tables: checkpoints, checkpoint_writes, checkpoint_blobs,    │
│            checkpoint_migrations (all created by setup())       │
│  • Production backend: PostgresSaver                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  LONG-TERM MEMORY  (PostgresStore)                              │
│                                                                  │
│  • Stores facts/preferences that survive ACROSS threads         │
│  • Scoped to namespace — typically [userId, "memories"]         │
│  • User starts a NEW conversation but agent still knows them    │
│  • Gives the model: "what I know about this user across time"   │
│  • Tables: store, store_migrations (created by setup())         │
│  • Production backend: PostgresStore (with optional pgvector    │
│    for semantic search)                                         │
└─────────────────────────────────────────────────────────────────┘
```

**One user, multiple threads:**
```
User "alice" → Thread A (support question) ──► checkpointer stores thread A state
             → Thread B (new day, new chat) ──► checkpointer stores thread B state
             → /memories/preferences.txt   ──► PostgresStore["alice", "memories"]
                                                (readable from BOTH Thread A and B)
```

**Backend routing with CompositeBackend:**
```
Agent writes /notes.txt              → StateBackend  → thread state (ephemeral)
Agent writes /memories/prefs.txt     → StoreBackend  → PostgresStore (permanent)
Agent reads  /memories/prefs.txt     → StoreBackend  → PostgresStore (permanent)
```

---

## Architecture Overview

```
Browser (Next.js App Router)
│
├── Clerk (frontend already done)
│
├── assistant-ui (useChatRuntime)
│   ├── ThreadHistoryAdapter   ──► GET/POST /api/threads/[id]/messages
│   ├── RemoteThreadListAdapter ──► GET/DELETE /api/threads
│   └── AttachmentAdapter      ──► POST /api/uploadthing (UploadThing FileRouter)
│                                        │
│                                        ▼
│                               UploadThing CDN (file.ufsUrl)
│
└── POST /api/chat
        │  (passes userId in context, threadId as thread_id)
        ├── Prisma (Neon Postgres)
        │   ├── threads table   (sidebar metadata)
        │   ├── messages table  (UI history for browser restore)
        │   └── users table     (synced from Clerk webhook)
        │
        └── createDeepAgent
            ├── checkpointer ──► PostgresSaver (Neon) ← SHORT-TERM per thread
            ├── store        ──► PostgresStore (Neon) ← LONG-TERM per user
            └── backend      ──► CompositeBackend
                                  ├── StateBackend  (default, ephemeral files)
                                  └── StoreBackend  (/memories/ → PostgresStore)
```

All four memory stores live in the same Neon database — different tables, different purposes:

| Tables | Managed by | Purpose |
|---|---|---|
| `users`, `threads`, `messages` | Prisma + your code | UI data |
| `checkpoints`, `checkpoint_writes`, `checkpoint_blobs`, `checkpoint_migrations` | `checkpointer.setup()` | Short-term agent memory |
| `store`, `store_migrations` | `store.setup()` | Long-term agent memory |

---

## 1. Project Setup

### Install dependencies

```bash
# Core agent
npm install deepagents
npm install @langchain/langgraph-checkpoint-postgres
npm install @ai-sdk/langchain

# UI
npm install @assistant-ui/react @assistant-ui/react-ai-sdk
npm install ai @ai-sdk/openai

# File uploads
npm install uploadthing @uploadthing/react

# Rate limiting
npm install @upstash/ratelimit @upstash/redis
```

### Environment variables

```bash
# .env.local

# Database (Neon) — already set up
DATABASE_URL=""            # Pooled — Prisma queries at runtime
DATABASE_URL_UNPOOLED=""   # Direct — PostgresSaver + PostgresStore + Prisma CLI

# Auth (Clerk) — already set up
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
CLERK_SECRET_KEY=""
CLERK_WEBHOOK_SECRET=""

# AI
OPENAI_API_KEY=""

# File Storage (UploadThing)
UPLOADTHING_TOKEN=""

# Rate Limiting (Upstash)
UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""

# Infrastructure
CRON_SECRET=""
```

---

## 2. PostgresSaver — Short-Term Memory (Checkpointer)

The checkpointer persists conversation state within a single thread. Every turn, LangGraph saves a snapshot of the full message history and agent state to Postgres. When the same `thread_id` is used on the next request, LangGraph loads from that snapshot — no re-seeding required from the client.

```ts
// lib/checkpointer.ts
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

// Uses the UNPOOLED connection — PostgresSaver needs a direct persistent connection,
// not a pooled one (PgBouncer breaks the LISTEN/NOTIFY mechanism LangGraph uses).
// Top-level await works in Next.js App Router (ES modules).
export const checkpointer = PostgresSaver.fromConnString(
  process.env.DATABASE_URL_UNPOOLED!
);

// Creates 4 tables if they don't exist. Idempotent — safe on every cold start.
// Tables: checkpoints, checkpoint_writes, checkpoint_blobs, checkpoint_migrations
await checkpointer.setup();
```

**What `setup()` creates:**

| Table | What it stores |
|---|---|
| `checkpoints` | One row per (thread_id, checkpoint_id) — the state snapshot |
| `checkpoint_writes` | Intermediate writes during a node execution — for fault tolerance |
| `checkpoint_blobs` | The serialized binary data for each state field |
| `checkpoint_migrations` | Schema version — prevents future LangGraph upgrades from breaking your DB |

You never query these tables directly. LangGraph owns them entirely.

---

## 3. PostgresStore — Long-Term Memory

The store persists facts, preferences, and learned context that survive across ALL threads for a user. When a user starts a brand new conversation (new `thread_id`), the agent can still read `/memories/preferences.txt` that was written in a conversation three weeks ago.

LangGraph stores long-term memories as JSON documents organized by a namespace (like a folder path) and a key (like a filename).

```ts
// lib/store.ts
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";

// Also uses UNPOOLED — same reason as the checkpointer.
export const store = PostgresStore.fromConnString(
  process.env.DATABASE_URL_UNPOOLED!
);

// Creates the store tables. Idempotent, safe on every cold start.
// Tables: store, store_migrations
await store.setup();

// Optional: enable semantic/vector search over stored memories.
// Requires pgvector extension on your Neon database.
// If you want this, uncomment and replace the lines above:
//
// export const store = PostgresStore.fromConnString(
//   process.env.DATABASE_URL_UNPOOLED!,
//   {
//     index: {
//       embed: "openai:text-embedding-3-small", // embedding model
//       dims: 1536,                              // dimensions for text-embedding-3-small
//       fields: ["$"],                           // embed the full document value
//     },
//   }
// );
// await store.setup();
//
// With this, store.search(namespace, { query: "user preferences" }) does
// semantic similarity search instead of just metadata filtering.
```

**How the store organizes data — namespace + key:**

```ts
// Namespace is like a folder path — always an array of strings.
// Key is like a filename within that folder.

// Good namespaces:
["user_abc123", "memories"]           // user's persistent memories
["user_abc123", "preferences"]        // user's preferences specifically
["user_abc123", "memories", "work"]   // nested sub-folder

// Storing data manually (for seeding or testing):
await store.put(
  ["user_abc123", "memories"],   // namespace
  "preferences",                 // key
  {
    language: "English",
    responseStyle: "concise",
    timezone: "Africa/Accra",
  }
);

// Reading data manually:
const item = await store.get(["user_abc123", "memories"], "preferences");
console.log(item?.value); // { language: "English", ... }

// Searching (basic filter):
const items = await store.search(["user_abc123", "memories"], {
  filter: { language: "English" },
});

// Searching (semantic — only works if you configured index above):
const items = await store.search(["user_abc123", "memories"], {
  query: "what language does the user speak",
});
```

**The agent uses the store indirectly via StoreBackend + the filesystem tools.** It writes `/memories/preferences.txt` using `write_file`, and `StoreBackend` translates that into a `store.put()` call under the namespace you configured. You don't write tools that call `store.put()` manually unless you want very fine-grained control.

---

## 4. createDeepAgent — Wiring Both Memory Systems

`createDeepAgent` is where both memory systems come together. The `CompositeBackend` is the routing layer:
- Any file the agent writes to a normal path (e.g. `/notes.txt`, `/scratch.md`) goes to `StateBackend` — ephemeral, lives only in the checkpoint for this thread.
- Any file the agent writes to `/memories/...` goes to `StoreBackend` — durable, stored in `PostgresStore`, readable in any future thread.

`createDeepAgent` also automatically attaches the `SummarizationMiddleware`, which monitors token usage and compresses old messages when thresholds are approached. **You don't build any of this yourself.**

```ts
// lib/agent.ts
import { createDeepAgent, CompositeBackend, StateBackend, StoreBackend } from "deepagents";
import { checkpointer } from "./checkpointer";
import { store } from "./store";
import { myTools } from "./tools";
import * as z from "zod";

// contextSchema defines what per-request context the agent receives.
// userId is critical — the StoreBackend uses it to namespace memories
// so user A can never read user B's memories.
export const contextSchema = z.object({
  userId: z.string(),
});

export const agent = createDeepAgent({
  model: "openai:gpt-4o",
  tools: myTools,

  // Short-term memory: PostgresSaver scoped to thread_id.
  // LangGraph loads this automatically on every invocation.
  checkpointer,

  // Long-term memory: PostgresStore accessible to the agent via filesystem tools.
  // The agent reads/writes /memories/* here. Shared across ALL threads for a user.
  store,

  // contextSchema makes userId available inside the agent's runtime.
  // This is how StoreBackend knows whose namespace to use.
  contextSchema,

  // CompositeBackend routes file operations to the right storage:
  //   /memories/...  → StoreBackend → PostgresStore (permanent, cross-thread)
  //   everything else → StateBackend → checkpoint state (ephemeral, this thread only)
  //
  // The config object passed to each backend contains the runtime context
  // including userId from contextSchema above.
  backend: (config) =>
    new CompositeBackend(
      new StateBackend(config),   // default — ephemeral scratch space
      {
        "/memories/": new StoreBackend(config),  // persistent memory
      }
    ),

  // createDeepAgent AUTOMATICALLY includes:
  //   - SummarizationMiddleware: compresses old messages when context limit approaches
  //   - FilesystemMiddleware: gives agent ls, read_file, write_file, edit_file tools
  //   - TodoListMiddleware: gives agent write_todos tool for task planning
  //   - SubAgentMiddleware: gives agent ability to spawn subagents
  //
  // You DO NOT add a preModelHook for summarization — it's already handled.

  // Tell the agent what the memory structure means, what to save, and when.
  // This is how the agent knows to use /memories/ for permanent storage.
  systemPrompt: `You are a helpful AI assistant.

## Memory

You have two types of memory:

**Short-term (this conversation only):**
Use /notes.txt or any path without /memories/ prefix for temporary scratch work.
These files are only available in this conversation.

**Long-term (permanent, across all conversations):**
Use /memories/ prefix for anything worth remembering across sessions:
- /memories/user_preferences.txt — communication style, language, timezone
- /memories/user_context.txt — occupation, goals, ongoing projects  
- /memories/facts.txt — specific facts the user has shared

Always check /memories/ at the start of a conversation for relevant context.
When users share preferences or important information, save it to /memories/.
`,
});
```

**Why is `systemPrompt` critical here?**

The agent has the filesystem tools but doesn't know what to store unless you tell it. Without the system prompt instructions, the agent won't write to `/memories/` even though it can. The system prompt is what transforms a capable tool into an opinionated memory system.

---

## 5. UploadThing Setup

### Step 1 — FileRouter

```ts
// app/api/uploadthing/core.ts
import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { auth } from "@clerk/nextjs/server";

const f = createUploadthing();

export const ourFileRouter = {
  chatAttachment: f({
    image: { maxFileSize: "10MB", maxFileCount: 4 },
    pdf: { maxFileSize: "32MB", maxFileCount: 2 },
    text: { maxFileSize: "64KB", maxFileCount: 2 },
  })
    .middleware(async () => {
      const { userId } = auth();
      if (!userId) throw new UploadThingError("Unauthorized");
      return { userId };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      console.log(`File uploaded by ${metadata.userId}: ${file.ufsUrl}`);
      return { url: file.ufsUrl, name: file.name };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
```

### Step 2 — Route handler

```ts
// app/api/uploadthing/route.ts
import { createRouteHandler } from "uploadthing/next";
import { ourFileRouter } from "./core";

export const { GET, POST } = createRouteHandler({ router: ourFileRouter });
```

### Step 3 — Typed client helpers

```ts
// lib/uploadthing.ts
import { generateReactHelpers, generateUploadDropzone } from "@uploadthing/react";
import type { OurFileRouter } from "@/app/api/uploadthing/core";

export const { useUploadThing, uploadFiles } = generateReactHelpers<OurFileRouter>();
export const UploadDropzone = generateUploadDropzone<OurFileRouter>();
```

### Step 4 — Root layout (SSR plugin)

```tsx
// app/layout.tsx
import { NextSSRPlugin } from "@uploadthing/react/next-ssr-plugin";
import { extractRouterConfig } from "uploadthing/server";
import { ourFileRouter } from "@/app/api/uploadthing/core";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NextSSRPlugin routerConfig={extractRouterConfig(ourFileRouter)} />
        {children}
      </body>
    </html>
  );
}
```

### Step 5 — Tailwind

**v3:** wrap `tailwind.config.ts` with `withUt` from `"uploadthing/tw"`.  
**v4:** add `@import "@uploadthing/react/styles.css"` to `globals.css`.

---

## 6. Attachment Adapter

```ts
// lib/attachment-adapter.ts
import type { AttachmentAdapter, PendingAttachment } from "@assistant-ui/react";
import { uploadFiles } from "@/lib/uploadthing";

export class UploadThingAttachmentAdapter implements AttachmentAdapter {
  accept = ["image/jpeg","image/png","image/webp","image/gif","application/pdf","text/plain","text/markdown"].join(",");

  async add({ file }: { file: File }) {
    return {
      id: crypto.randomUUID(),
      type: "file" as const,
      name: file.name,
      contentType: file.type,
      file,
    };
  }

  async send(attachment: PendingAttachment) {
    const file = (attachment as any).file as File;
    const [uploaded] = await uploadFiles("chatAttachment", { files: [file] });
    if (!uploaded) throw new Error("Upload failed");

    const isImage = file.type.startsWith("image/");
    return {
      ...attachment,
      status: { type: "complete" as const },
      content: isImage
        ? [{ type: "image" as const, image: uploaded.ufsUrl }]
        : [{ type: "file" as const, mimeType: file.type, filename: file.name, data: uploaded.ufsUrl }],
    };
  }

  async remove() {}
}
```

---

## 7. The Chat API Route

This is the most important change from the old `createAgent` setup. You now pass `userId` in the `context` field. The agent uses this to namespace its long-term memories in PostgresStore so that user A's memories are never accessible to user B.

```ts
// app/api/chat/route.ts
import { auth } from "@clerk/nextjs/server";
import { toBaseMessages, toUIMessageStream } from "@ai-sdk/langchain";
import { agent } from "@/lib/agent";
import { db } from "@/lib/db";
import { rateLimiter } from "@/lib/rate-limit";
import type { UIMessage } from "ai";

export const maxDuration = 60;

export async function POST(req: Request) {
  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const { userId } = auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  // ── 2. Rate limiting ──────────────────────────────────────────────────────
  const { success, limit, remaining } = await rateLimiter.limit(userId);
  if (!success) {
    return Response.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": String(remaining),
          "Retry-After": "60",
        },
      }
    );
  }

  const { messages, id: threadId }: { messages: UIMessage[]; id: string } =
    await req.json();

  if (!messages?.length || !threadId) {
    return new Response("Bad request", { status: 400 });
  }

  // ── 3. Verify thread ownership ────────────────────────────────────────────
  const existingThread = await db.thread.findUnique({
    where: { id: threadId },
    select: { userId: true },
  });

  if (existingThread && existingThread.userId !== userId) {
    return new Response("Forbidden", { status: 403 });
  }

  // ── 4. Create thread on first message ─────────────────────────────────────
  const isFirstMessage = messages.length === 1;

  if (!existingThread) {
    await db.thread.create({
      data: {
        id: threadId,
        userId,
        title: extractTextPreview(messages[0], 60),
      },
    });
  } else {
    await db.thread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    });
  }

  // ── 5. Stream the agent ───────────────────────────────────────────────────
  const latestMessage = messages[messages.length - 1];

  const agentStream = await agent.stream(
    { messages: await toBaseMessages([latestMessage]) },
    {
      // thread_id scopes the SHORT-TERM memory (checkpointer)
      configurable: { thread_id: threadId },

      // context.userId scopes the LONG-TERM memory (PostgresStore via StoreBackend)
      // The StoreBackend uses this to namespace /memories/ under this user's ID.
      // Without this, all users would share the same memory namespace.
      context: { userId },
    }
  );

  const uiStream = toUIMessageStream(agentStream, {
    onFinish: async () => {
      if (isFirstMessage) {
        generateThreadTitle(threadId, userId, latestMessage).catch(console.error);
      }
    },
  });

  return new Response(uiStream);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractTextPreview(message: UIMessage, maxLen: number): string {
  for (const part of message.parts ?? []) {
    if (part.type === "text" && part.text) return part.text.slice(0, maxLen);
  }
  return "New conversation";
}

async function generateThreadTitle(
  threadId: string,
  userId: string,
  firstMessage: UIMessage
) {
  const thread = await db.thread.findFirst({ where: { id: threadId, userId } });
  if (!thread) return;

  const text = extractTextPreview(firstMessage, 200);
  if (!text || text === "New conversation") return;

  const { generateText } = await import("ai");
  const { openai } = await import("@ai-sdk/openai");

  const { text: title } = await generateText({
    model: openai("gpt-4o-mini"),
    prompt: `Generate a short, descriptive title (max 6 words, no quotes, no punctuation at end) for a conversation that starts with: "${text}"`,
    maxTokens: 20,
  });

  await db.thread.update({
    where: { id: threadId },
    data: { title: title.trim() },
  });
}
```

---

## 8. Thread Management API Routes

```ts
// app/api/threads/route.ts
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

export async function GET() {
  const { userId } = auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const threads = await db.thread.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, updatedAt: true, createdAt: true },
  });

  return Response.json(threads);
}
```

```ts
// app/api/threads/[threadId]/route.ts
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

export async function DELETE(
  _req: Request,
  { params }: { params: { threadId: string } }
) {
  const { userId } = auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const thread = await db.thread.findFirst({
    where: { id: params.threadId, userId },
  });

  if (!thread) return new Response("Not found", { status: 404 });

  await db.thread.delete({ where: { id: params.threadId } });
  return new Response(null, { status: 204 });
}
```

```ts
// app/api/threads/[threadId]/messages/route.ts
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: { threadId: string } }
) {
  const { userId } = auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const thread = await db.thread.findFirst({
    where: { id: params.threadId, userId },
  });
  if (!thread) return new Response("Not found", { status: 404 });

  const messages = await db.message.findMany({
    where: { threadId: params.threadId },
    orderBy: { createdAt: "asc" },
    select: { id: true, parentId: true, format: true, content: true },
  });

  return Response.json(messages);
}

export async function POST(
  req: Request,
  { params }: { params: { threadId: string } }
) {
  const { userId } = auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const thread = await db.thread.findFirst({
    where: { id: params.threadId, userId },
  });
  if (!thread) return new Response("Not found", { status: 404 });

  const { id, parentId, format, content } = await req.json();

  await db.message.upsert({
    where: { id },
    create: { id, threadId: params.threadId, parentId: parentId ?? null, format, content },
    update: { content },
  });

  return Response.json({ ok: true });
}
```

---

## 9. Frontend — Runtime Provider

```tsx
// components/chat-provider.tsx
"use client";

import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  useRemoteThreadListRuntime,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
  RuntimeAdapterProvider,
  useThreadListItem,
} from "@assistant-ui/react";
import { DefaultChatTransport } from "ai";
import { useMemo, type ReactNode } from "react";
import { UploadThingAttachmentAdapter } from "@/lib/attachment-adapter";

const threadListAdapter: RemoteThreadListAdapter = {
  async list() {
    const threads = await fetch("/api/threads").then((r) => r.json());
    return {
      threads: threads.map((t: any) => ({
        remoteId: t.id,
        status: "regular" as const,
        title: t.title ?? "New conversation",
      })),
    };
  },
  async initialize(localId: string) {
    return { remoteId: localId };
  },
  async rename(remoteId: string, title: string) {
    await fetch(`/api/threads/${remoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  },
  async delete(remoteId: string) {
    await fetch(`/api/threads/${remoteId}`, { method: "DELETE" });
  },
  unstable_Provider: ThreadScopedProvider,
};

function ThreadScopedProvider({ children }: { children: ReactNode }) {
  const threadListItem = useThreadListItem();
  const remoteId = threadListItem.remoteId;

  const historyAdapter = useMemo<ThreadHistoryAdapter>(
    () => ({
      async load() { return { headId: null, messages: [] }; },
      async append() {},
      withFormat: (fmt) => ({
        async load() {
          if (!remoteId) return { messages: [] };
          const rows = await fetch(`/api/threads/${remoteId}/messages`).then((r) => r.json());
          return { messages: rows.map(fmt.decode) };
        },
        async append(item) {
          if (!remoteId) return;
          await fetch(`/api/threads/${remoteId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: fmt.getId(item.message),
              parentId: item.parentId,
              format: fmt.format,
              content: fmt.encode(item),
            }),
          });
        },
      }),
    }),
    [remoteId]
  );

  return (
    <RuntimeAdapterProvider adapters={{ history: historyAdapter }}>
      {children}
    </RuntimeAdapterProvider>
  );
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () =>
      useChatRuntime({
        transport: new DefaultChatTransport({
          api: "/api/chat",
          prepareSendMessagesRequest({ messages, id }) {
            return {
              body: {
                messages: [messages[messages.length - 1]],
                id,
              },
            };
          },
        }),
        adapters: {
          attachments: new UploadThingAttachmentAdapter(),
        },
      }),
    adapter: threadListAdapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
```

---

## 10. Sidebar Component

```tsx
// components/sidebar.tsx
"use client";

import { useThreadList, ThreadListPrimitive, useThreadListItem } from "@assistant-ui/react";
import { PlusIcon, TrashIcon, MessageSquareIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const { threads, switchToNewThread } = useThreadList();

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-background">
      <div className="p-3">
        <button
          onClick={switchToNewThread}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted transition-colors"
        >
          <PlusIcon className="h-4 w-4" />
          New conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Recent
        </p>
        <ThreadListPrimitive.Root>
          {threads.map((thread) => (
            <ThreadItem key={thread.id} threadId={thread.id} />
          ))}
        </ThreadListPrimitive.Root>
      </div>
    </aside>
  );
}

function ThreadItem({ threadId }: { threadId: string }) {
  const { thread, isSelected, select } = useThreadListItem(threadId);

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer",
        "hover:bg-muted transition-colors",
        isSelected && "bg-muted font-medium"
      )}
      onClick={select}
    >
      <MessageSquareIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{thread.title ?? "New conversation"}</span>
      <button
        className="hidden group-hover:flex items-center justify-center h-5 w-5 rounded hover:text-destructive"
        onClick={(e) => { e.stopPropagation(); thread.delete?.(); }}
      >
        <TrashIcon className="h-3 w-3" />
      </button>
    </div>
  );
}
```

---

## 11. Main Page Layout

```tsx
// app/chat/page.tsx
import { ChatProvider } from "@/components/chat-provider";
import { Sidebar } from "@/components/sidebar";
import { Thread } from "@/components/assistant-ui/thread";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default function ChatPage() {
  const { userId } = auth();
  if (!userId) redirect("/sign-in");

  return (
    <ChatProvider>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <Thread />
        </main>
      </div>
    </ChatProvider>
  );
}
```

---

## 12. Rate Limiting

```ts
// lib/rate-limit.ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const rateLimiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, "1 m"),
  analytics: true,
  prefix: "chat_rl",
});
```

---

## 13. Database Cleanup Cron Job

```ts
// app/api/cron/cleanup/route.ts
import { db } from "@/lib/db";
import { UTApi } from "uploadthing/server";

const utapi = new UTApi();

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  // Delete old threads — cascades to messages
  const deleted = await db.thread.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  });

  // Clean LangGraph's short-term memory tables (not in Prisma schema — raw SQL)
  await db.$executeRaw`
    DELETE FROM checkpoints
    WHERE thread_id IN (
      SELECT thread_id FROM checkpoints
      GROUP BY thread_id
      HAVING MAX(created_at) < ${cutoff}
    )
  `;

  // NOTE: Long-term memory (PostgresStore / store table) is intentionally NOT
  // deleted here. The whole point of the store is permanent cross-thread memory.
  // Only delete store entries if the user deletes their account.

  return Response.json({ ok: true, deletedThreads: deleted.count });
}
```

```json
// vercel.json
{
  "crons": [{ "path": "/api/cron/cleanup", "schedule": "0 3 * * *" }]
}
```

**Important:** When a user deletes their account, you should delete their store entries too:

```ts
// In your user deletion handler (Clerk webhook user.deleted event):
import { store } from "@/lib/store";

async function deleteUserData(userId: string) {
  // Delete all threads (cascades to messages)
  await db.user.delete({ where: { id: userId } });

  // Delete long-term memories from PostgresStore
  const items = await store.search([userId, "memories"], {});
  for (const item of items) {
    await store.delete([userId, "memories"], item.key);
  }
}
```

---

## 14. Development vs Production Backends

Use `InMemoryStore` and `InMemorySaver` during development — no DB connection needed, instant setup, resets on restart which is fine for testing. Never in production.

```ts
// lib/agent.ts — dev/prod switch
import { InMemoryStore } from "@langchain/langgraph";
import { InMemorySaver } from "@langchain/langgraph";

const isDev = process.env.NODE_ENV === "development";

// Lazy imports so the postgres packages aren't loaded in dev if not needed
const checkpointer = isDev
  ? new InMemorySaver()
  : (await import("./checkpointer")).checkpointer;

const store = isDev
  ? new InMemoryStore()
  : (await import("./store")).store;
```

---

## 15. Environment Variables Reference

```bash
# Database (Neon)
DATABASE_URL=""            # Pooled — Prisma runtime queries
DATABASE_URL_UNPOOLED=""   # Direct — PostgresSaver, PostgresStore, prisma migrate

# Auth (Clerk)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
CLERK_SECRET_KEY=""
CLERK_WEBHOOK_SECRET=""

# AI
OPENAI_API_KEY=""

# File Storage (UploadThing)
UPLOADTHING_TOKEN=""

# Rate Limiting (Upstash)
UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""

# Infrastructure
CRON_SECRET=""
```

---

## 16. Deployment Checklist

**Database**
- [ ] `npx prisma migrate deploy` run against production Neon database
- [ ] `DATABASE_URL` is the **pooled** Neon connection string (Prisma runtime)
- [ ] `DATABASE_URL_UNPOOLED` is the **direct** Neon connection string (PostgresSaver, PostgresStore, Prisma CLI)
- [ ] `checkpointer.setup()` auto-runs on first cold start — creates short-term memory tables
- [ ] `store.setup()` auto-runs on first cold start — creates long-term memory tables
- [ ] (If using vector search) pgvector extension enabled on Neon: `CREATE EXTENSION IF NOT EXISTS vector`

**Auth**
- [ ] Clerk webhook registered, `CLERK_WEBHOOK_SECRET` set in Vercel env vars
- [ ] Next.js middleware protects `/chat`, `/api/chat`, `/api/threads`

**Agent**
- [ ] `contextSchema` defined with `userId: z.string()`
- [ ] `context: { userId }` passed in every `agent.stream()` call
- [ ] `systemPrompt` includes memory structure instructions
- [ ] Model supports multimodal input (GPT-4o, Claude 3.5+, Gemini 1.5+)
- [ ] `maxDuration = 60` set on chat route (Vercel Pro — Hobby cap is 10s)

**UploadThing**
- [ ] App created in uploadthing.com dashboard
- [ ] `UPLOADTHING_TOKEN` copied to Vercel env vars
- [ ] `NextSSRPlugin` added to root layout
- [ ] Tailwind config updated (`withUt` for v3, `@import` for v4)

**Vercel**
- [ ] All env vars added in Vercel project settings
- [ ] `CRON_SECRET` set, matches `vercel.json` cron auth
- [ ] `vercel.json` committed and deployed

---

## 17. Complete File Tree

```
├── app/
│   ├── api/
│   │   ├── chat/route.ts                 ← agent stream, thread create, title gen
│   │   ├── uploadthing/
│   │   │   ├── core.ts                   ← FileRouter (file types, auth, size limits)
│   │   │   └── route.ts                  ← createRouteHandler
│   │   ├── threads/
│   │   │   ├── route.ts                  ← GET (sidebar list)
│   │   │   └── [threadId]/
│   │   │       ├── route.ts              ← DELETE thread
│   │   │       └── messages/route.ts     ← GET + POST (history restore + save)
│   │   ├── webhooks/
│   │   │   └── clerk/route.ts            ← user sync (already done)
│   │   └── cron/
│   │       └── cleanup/route.ts          ← nightly cleanup
│   ├── chat/page.tsx                     ← main chat page
│   └── layout.tsx                        ← NextSSRPlugin here
│
├── components/
│   ├── chat-provider.tsx                 ← all runtime wiring
│   ├── sidebar.tsx                       ← thread list UI
│   └── assistant-ui/                     ← generated by assistant-ui CLI
│       ├── thread.tsx
│       └── attachment.tsx
│
├── lib/
│   ├── agent.ts                          ← createDeepAgent + CompositeBackend
│   ├── checkpointer.ts                   ← PostgresSaver singleton (short-term)
│   ├── store.ts                          ← PostgresStore singleton (long-term)
│   ├── db.ts                             ← Prisma singleton (already done)
│   ├── uploadthing.ts                    ← typed UploadThing helpers
│   ├── attachment-adapter.ts             ← UploadThingAttachmentAdapter
│   └── rate-limit.ts                     ← Upstash rate limiter
│
├── prisma/
│   └── schema.prisma                     ← already done
│
└── vercel.json                           ← cron schedule
```

---

## Key Mental Model Summary

| Memory Type | What It Stores | Scoped To | Table | Who Manages It |
|---|---|---|---|---|
| Short-term | Conversation turns in THIS thread | `thread_id` | `checkpoints` tables | `PostgresSaver` |
| Long-term | Facts across ALL threads | `[userId, "memories"]` | `store` tables | `PostgresStore` |
| UI history | UIMessage[] for browser render | `thread_id` | `messages` | Your Prisma code |
| Thread list | Sidebar metadata | `userId` | `threads` | Your Prisma code |
| Files | Images, PDFs | Per file key | UploadThing CDN | UploadThing |

**The golden rule on `DATABASE_URL_UNPOOLED`:**
Both `PostgresSaver` and `PostgresStore` require a **direct** connection, not a pooled one. Neon's PgBouncer pool (the pooled URL) breaks LangGraph's internal connection management. Always use `DATABASE_URL_UNPOOLED` for both. Prisma uses the pooled URL for queries — that's fine.

**The golden rule on `context.userId`:**
Without passing `context: { userId }` to every `agent.stream()` call, `StoreBackend` has no user identity to namespace memories under. All users would share the same `/memories/` space, which is a serious data isolation bug. Always pass `context: { userId }` — it's the only thing standing between per-user isolation and everyone reading everyone's memories.

