# The Complete Production Cookbook
## LangChain `createAgent` / `createDeepAgent` + `@ai-sdk/langchain` + `assistant-ui`

> **Who this is for:** You want to build a real Next.js AI chat app using LangChain's agents for the
> brain, the Vercel AI SDK as the bridge layer, and `assistant-ui` as the polished React UI — without
> deploying to LangSmith or any managed platform.

---

## Table of Contents

1. [Mental Model — How the Three Pieces Fit Together](#1-mental-model)
2. [Project Setup & Installation](#2-project-setup--installation)
3. [The Backend Route — Your Agent's Home](#3-the-backend-route)
4. [The Frontend — assistant-ui wired to Your Agent](#4-the-frontend)
5. [Tool Calls — Making Them Visible in the UI](#5-tool-calls)
6. [Human-in-the-Loop (HITL) — Pausing for Approval](#6-human-in-the-loop)
7. [Custom Tool UIs — Rich Interactive Components](#7-custom-tool-uis)
8. [`createDeepAgent` & the Todo List](#8-createdeepagent--the-todo-list)
9. [Streaming Custom Data from Tools](#9-streaming-custom-data-from-tools)
10. [Multi-Step Agent Loops](#10-multi-step-agent-loops)
11. [Persisting Chat History](#11-persisting-chat-history)
12. [Token Usage Display](#12-token-usage-display)
13. [Environment Variables & Project Structure](#13-environment-variables--project-structure)
14. [Common Mistakes & How to Avoid Them](#14-common-mistakes--how-to-avoid-them)

---

## 1. Mental Model

Before writing a single line of code, you need to understand **where each technology lives and what
job it does**. Get this wrong and you'll spend hours debugging the wrong layer.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  BROWSER (React / Next.js Client Components)                                 │
│                                                                              │
│  assistant-ui                                                                │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  <Thread />  ←  the entire chat UI (messages, input, tool cards)     │   │
│  │  <AssistantRuntimeProvider runtime={runtime}>                        │   │
│  │       ↑ this wraps everything                                        │   │
│  │  useChatRuntime({ transport: new AssistantChatTransport({...}) })    │   │
│  │       ↑ this is assistant-ui calling useChat internally for you     │   │
│  │       ↑ you never call useChat yourself                              │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Custom tool UI components:                                                  │
│  makeAssistantToolUI(...)  ← renders tool calls visually                     │
│  makeAssistantTool(...)    ← defines + renders client-side tools             │
└──────────────────────────────────────────────────────────────────────────────┘
           ↑↓  HTTP POST — streams UIMessageStream (Server-Sent Events)
┌──────────────────────────────────────────────────────────────────────────────┐
│  SERVER (Next.js API Route — /app/api/agent/route.ts)                        │
│                                                                              │
│  1. Receive { messages: UIMessage[] } from assistant-ui                      │
│  2. toBaseMessages(messages)    ← @ai-sdk/langchain converts to LangChain    │
│  3. agent.streamEvents(...)     ← run YOUR createAgent / createDeepAgent     │
│  4. toUIMessageStream(events)   ← @ai-sdk/langchain converts back to AI SDK  │
│  5. createUIMessageStreamResponse(stream)  ← wrap in HTTP Response           │
└──────────────────────────────────────────────────────────────────────────────┘
           ↑
┌──────────────────────────────────────────────────────────────────────────────┐
│  AGENT (can be in the same file or a separate lib/ file)                     │
│                                                                              │
│  createAgent({ model, tools, systemPrompt })                                 │
│  createDeepAgent({ model, tools, subagents, systemPrompt })                  │
│       ↑ returns a compiled LangGraph graph                                   │
│       ↑ handles its own tool loop, planning, file system, sub-agents         │
└──────────────────────────────────────────────────────────────────────────────┘
```

**The golden rule:**
- **`@ai-sdk/langchain`** lives entirely on the **server**. It's just a format translator.
- **`assistant-ui`** lives entirely on the **client**. It replaces `useChat` so you don't have to.
- **`createAgent` / `createDeepAgent`** runs on the **server** inside your API route.

---

## 2. Project Setup & Installation

### Create the Next.js app

```bash
npx create-next-app@latest my-agent-app --typescript --tailwind --app
cd my-agent-app
```

### Install all dependencies

```bash
# Core AI SDK + LangChain adapter
npm install ai @ai-sdk/react @ai-sdk/langchain @ai-sdk/openai

# LangChain agent + deepagents
npm install langchain @langchain/core @langchain/openai deepagents

# assistant-ui
npm install @assistant-ui/react @assistant-ui/react-ai-sdk

# Utilities
npm install zod
```

### Scaffold the assistant-ui components

`assistant-ui` ships a CLI to generate the `<Thread />` component with all
the required sub-components (messages, composer, tool slots, etc.) already wired:

```bash
npx assistant-ui@latest add thread
```

This creates `components/assistant-ui/thread.tsx` (and related files) in your project. You will
import `<Thread />` from there throughout this cookbook.

---

## 3. The Backend Route

This is where 90% of your AI logic lives. The route receives a message from the frontend, runs your
LangChain agent, and streams the result back.

### 3.1 Basic `createAgent` route

```typescript
// app/api/agent/route.ts
import { toBaseMessages, toUIMessageStream } from "@ai-sdk/langchain";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "langchain";
import { z } from "zod";

export const maxDuration = 60; // allow up to 60s for long agent runs

// ─── Define your model ───────────────────────────────────────────────────────
const model = new ChatOpenAI({
  model: "gpt-4o",
  temperature: 0,
});

// ─── Define your tools ───────────────────────────────────────────────────────
const getWeather = tool(
  async ({ city }: { city: string }) => {
    // In reality, call a real weather API here
    return `The weather in ${city} is sunny and 24°C.`;
  },
  {
    name: "get_weather",
    description: "Get the current weather for a given city",
    schema: z.object({
      city: z.string().describe("The name of the city"),
    }),
  }
);

const searchWeb = tool(
  async ({ query }: { query: string }) => {
    // In reality, call Tavily, Brave, or your preferred search API
    return `Search results for "${query}": [result 1], [result 2]...`;
  },
  {
    name: "search_web",
    description: "Search the web for up-to-date information",
    schema: z.object({
      query: z.string().describe("The search query"),
    }),
  }
);

// ─── Create the agent (once, outside the handler — reused across requests) ───
const agent = createAgent({
  model,
  tools: [getWeather, searchWeb],
  systemPrompt: `You are a helpful AI assistant. Use tools when needed.
Always be concise and accurate.`,
});

// ─── The route handler ────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Step 1: Convert AI SDK UIMessages → LangChain BaseMessages
  const langchainMessages = await toBaseMessages(messages);

  // Step 2: Run the agent with streamEvents()
  // WHY streamEvents() and not agent.stream()?
  // → createAgent() agents need streamEvents() to get granular tool call events.
  //   Using agent.stream() directly causes a "content is not iterable" runtime error.
  const streamEvents = agent.streamEvents(
    { messages: langchainMessages },
    { version: "v2" }
  );

  // Step 3: Convert the LangChain event stream → AI SDK UIMessageStream
  // → toUIMessageStream auto-detects the event type, handles text, tool calls,
  //   tool results, reasoning tokens, and custom data automatically.
  return createUIMessageStreamResponse({
    stream: toUIMessageStream(streamEvents),
  });
}
```

> **Why create the agent outside the handler?**
> Creating a `ChatOpenAI` and compiling the LangGraph graph has some overhead. Since Next.js
> reuses module scope across requests in production, defining `agent` once at module level means
> you pay that cost once, not on every request.

---

### 3.2 Receiving frontend tools from assistant-ui

`assistant-ui`'s default transport (`AssistantChatTransport`) automatically sends any client-side
tools you register to the backend. To consume them, use `frontendTools`:

```typescript
// app/api/agent/route.ts
import { toBaseMessages, toUIMessageStream } from "@ai-sdk/langchain";
import { createUIMessageStreamResponse, type UIMessage, convertToModelMessages } from "ai";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import { streamText } from "ai"; // only needed when mixing with pure AI SDK tools

export async function POST(req: Request) {
  const {
    messages,
    system,
    tools: clientTools, // ← tools serialized from the browser by AssistantChatTransport
  }: { messages: UIMessage[]; system?: string; tools?: any } = await req.json();

  const langchainMessages = await toBaseMessages(messages);

  const streamEvents = agent.streamEvents(
    { messages: langchainMessages },
    { version: "v2" }
  );

  return createUIMessageStreamResponse({
    stream: toUIMessageStream(streamEvents),
  });
}
```

---

## 4. The Frontend

### 4.1 The minimal working page

```tsx
// app/page.tsx
"use client";

import { Thread } from "@/components/assistant-ui/thread";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";

export default function HomePage() {
  // useChatRuntime wraps AI SDK's useChat internally.
  // You never call useChat yourself — assistant-ui does it for you.
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: "/api/agent", // ← points to your backend route
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {/* Thread is the complete chat UI: messages, input box, tool renders */}
      <div className="h-dvh">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}
```

**That's it for the basic wiring.** `<Thread />` handles:
- Rendering all messages (text + tool calls + tool results)
- The composer (input box + send button)
- Loading / streaming states
- Scroll-to-bottom behavior
- Message branching (edit & regenerate)

---

### 4.2 What `useChatRuntime` vs `useAISDKRuntime` means

| Hook | When to use |
|---|---|
| `useChatRuntime` | The default. Does everything for you — creates `useChat` internally, handles cloud persistence, adapter slots. **Use this 99% of the time.** |
| `useAISDKRuntime(chat)` | Only when you need to share the raw `useChat` instance with non-assistant-ui code. Does NOT include cloud or adapter slots. |

---

## 5. Tool Calls

When your agent calls a tool, the AI SDK automatically sends those calls down the stream as typed
`tool-*` parts on the message. `assistant-ui`'s `<Thread />` component renders them inline by
default, but you can — and should — create custom UIs for them.

### 5.1 How tool call data flows

```
LangChain tool call event
        ↓
toUIMessageStream() converts it to a UIMessageChunk { type: "tool-input-delta" }
        ↓
useChat (inside assistant-ui) receives it and appends it to message.parts
        ↓
message.parts = [
  { type: "text",        text: "Let me check the weather..." },
  { type: "tool-get_weather", toolCallId: "abc", state: "call",   args: { city: "Tokyo" } },
  { type: "tool-get_weather", toolCallId: "abc", state: "result", result: "24°C, sunny" },
]
        ↓
<Thread /> renders each part. If you've registered a ToolUI for "get_weather", it shows that.
Otherwise it falls back to a plain JSON display.
```

### 5.2 `makeAssistantToolUI` — UI-only (tool runs on server)

Use this when the tool is defined and executed in your **backend** (inside `createAgent`), and you
just want to control how it looks in the chat:

```tsx
// components/tools/WeatherToolUI.tsx
"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";

// Type parameters: <TArgs, TResult>
export const WeatherToolUI = makeAssistantToolUI<
  { city: string },
  { temperature: string; condition: string }
>({
  toolName: "get_weather", // MUST exactly match the tool name in createAgent()

  render: ({ args, result, status }) => {
    // status.type is: "running" | "complete" | "incomplete"

    if (status.type === "running") {
      return (
        <div className="flex items-center gap-2 rounded-lg border bg-blue-50 p-3">
          <span className="animate-spin">⟳</span>
          <span className="text-sm text-blue-700">
            Checking weather in <strong>{args.city}</strong>…
          </span>
        </div>
      );
    }

    if (status.type === "complete" && result) {
      return (
        <div className="rounded-lg border bg-sky-50 p-4">
          <p className="text-sm font-semibold text-sky-800">
            🌤 Weather in {args.city}
          </p>
          <p className="mt-1 text-2xl font-bold">{result.temperature}</p>
          <p className="text-sm text-gray-500">{result.condition}</p>
        </div>
      );
    }

    if (status.type === "incomplete") {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          ⚠ Weather check failed.
        </div>
      );
    }

    return null;
  },
});
```

### 5.3 Register your Tool UIs in the page

Tool UI components don't render anything visible on their own — they register themselves in the
assistant context so `<Thread />` knows to use them when that tool name appears:

```tsx
// app/page.tsx
"use client";

import { Thread } from "@/components/assistant-ui/thread";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import { WeatherToolUI } from "@/components/tools/WeatherToolUI";
import { SearchToolUI } from "@/components/tools/SearchToolUI";

export default function HomePage() {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({ api: "/api/agent" }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {/* Register tool UIs — they render nothing, just register */}
      <WeatherToolUI />
      <SearchToolUI />

      <div className="h-dvh">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}
```

---

## 6. Human-in-the-Loop

Human-in-the-loop (HITL) means the agent pauses and waits for a human to approve or respond before
continuing. There are two approaches depending on where your tools live.

### 6.1 Approach A — AI SDK `needsApproval` (Simpler, for pure AI SDK tools)

This is the cleanest approach if you are NOT using LangChain tools for the thing that needs approval.
Define the tool with `streamText` (not `createAgent`) and add `needsApproval: true`:

```typescript
// app/api/agent/route.ts  (AI SDK-native HITL version)
import { streamText, convertToModelMessages, tool, zodSchema } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { UIMessage } from "ai";

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: openai("gpt-4o"),
    messages: await convertToModelMessages(messages),
    tools: {
      delete_record: tool({
        description: "Permanently delete a database record",
        inputSchema: zodSchema(
          z.object({
            recordId: z.string(),
            tableName: z.string(),
          })
        ),
        // ← This single flag pauses execution and asks the user first
        needsApproval: true,
        execute: async ({ recordId, tableName }) => {
          // This only runs AFTER the user approves in the UI
          await db.delete(tableName, recordId);
          return { deleted: true, recordId };
        },
      }),
    },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
```

On the frontend, check for the `approval-requested` state in a custom ToolUI and render
Approve / Deny buttons:

```tsx
// components/tools/DeleteRecordToolUI.tsx
"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { useChat } from "@ai-sdk/react"; // only for addToolApprovalResponse

// assistant-ui exposes addToolApprovalResponse through its runtime
// The cleanest way is to use useAISDKRuntime and call it from the runtime.
// Or define this as a makeAssistantTool (client-side) so you get `addResult`.

export const DeleteRecordToolUI = makeAssistantToolUI<
  { recordId: string; tableName: string },
  { deleted: boolean }
>({
  toolName: "delete_record",
  render: ({ args, result, status, addResult }) => {
    // status.type === "requires-action" means needsApproval is waiting
    if (status.type === "requires-action" && status.reason === "approval-required") {
      return (
        <div className="rounded-lg border-2 border-yellow-400 bg-yellow-50 p-4">
          <h4 className="font-bold text-yellow-800">⚠ Approval Required</h4>
          <p className="mt-1 text-sm">
            Delete record <code>{args.recordId}</code> from{" "}
            <code>{args.tableName}</code>?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => addResult!({ deleted: true, recordId: args.recordId })}
              className="rounded bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
            >
              Yes, Delete
            </button>
            <button
              onClick={() => addResult!({ deleted: false, recordId: args.recordId })}
              className="rounded bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    if (result?.deleted) {
      return (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          ✅ Record {args.recordId} deleted.
        </div>
      );
    }

    if (result && !result.deleted) {
      return (
        <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
          ❌ Deletion cancelled.
        </div>
      );
    }

    return (
      <div className="text-sm text-gray-500">Preparing deletion request…</div>
    );
  },
});
```

### 6.2 Approach B — LangChain-native HITL with `makeAssistantTool` + `human()`

Use this when the tool is defined on the **client** side via `makeAssistantTool`. The `human()`
helper pauses the tool's `execute` function until your UI calls `resume()`:

```tsx
// components/tools/ConfirmPaymentTool.tsx
"use client";

import { makeAssistantTool, tool } from "@assistant-ui/react";
import { z } from "zod";

// 1. Define the tool with human() in its execute function
const confirmPaymentTool = tool({
  description: "Process a payment after user confirmation",
  parameters: z.object({
    amount: z.number().describe("Amount in USD"),
    recipient: z.string().describe("Recipient name or account"),
  }),
  execute: async ({ amount, recipient }, { human }) => {
    // human() PAUSES execution here and returns to the UI to render
    // The interrupt payload is whatever you pass to human()
    const response = await human({
      type: "payment-confirmation",
      message: `Confirm payment of $${amount} to ${recipient}?`,
      amount,
      recipient,
    });

    if (!response.approved) {
      return { status: "cancelled", reason: "User denied the payment" };
    }

    // If approved, continue with actual payment
    // await processPayment(amount, recipient);
    return { status: "completed", transactionId: `txn_${Date.now()}` };
  },
});

// 2. Register it with makeAssistantTool and add the render UI
export const ConfirmPaymentTool = makeAssistantTool({
  ...confirmPaymentTool,
  toolName: "confirm_payment",

  // render receives: args, result, status, interrupt, resume
  render: ({ args, result, interrupt, resume }) => {
    // interrupt is populated when human() is waiting
    if (interrupt) {
      return (
        <div className="rounded-lg border-2 border-orange-400 bg-orange-50 p-5">
          <h3 className="text-lg font-bold text-orange-900">
            💳 Payment Confirmation
          </h3>
          <p className="mt-2 text-sm text-orange-800">
            {interrupt.payload.message}
          </p>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => resume({ approved: true })}
              className="rounded-lg bg-green-500 px-5 py-2 font-semibold text-white hover:bg-green-600"
            >
              Approve
            </button>
            <button
              onClick={() => resume({ approved: false })}
              className="rounded-lg bg-gray-200 px-5 py-2 font-semibold text-gray-700 hover:bg-gray-300"
            >
              Deny
            </button>
          </div>
        </div>
      );
    }

    if (result?.status === "completed") {
      return (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          ✅ Payment complete — Transaction {result.transactionId}
        </div>
      );
    }

    if (result?.status === "cancelled") {
      return (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          ❌ Payment cancelled: {result.reason}
        </div>
      );
    }

    return <div className="text-sm text-gray-500">Processing payment request…</div>;
  },
});
```

Then in your page, just include the component:

```tsx
// app/page.tsx
<AssistantRuntimeProvider runtime={runtime}>
  <ConfirmPaymentTool />   {/* ← registers the tool AND its UI */}
  <div className="h-dvh">
    <Thread />
  </div>
</AssistantRuntimeProvider>
```

---

## 7. Custom Tool UIs

### 7.1 Multi-step wizard tool

Sometimes a tool needs to collect information from the user in **multiple steps** before it can
complete. Use `human()` multiple times inside `execute`:

```tsx
// components/tools/ReportWizardTool.tsx
"use client";

import { makeAssistantTool, tool } from "@assistant-ui/react";
import { z } from "zod";

const reportWizardTool = tool({
  description: "Generate a custom report by collecting user preferences",
  parameters: z.object({
    topic: z.string(),
  }),
  execute: async ({ topic }, { human }) => {
    // Step 1: Ask for date range
    const { startDate, endDate } = await human({
      step: "date-range",
      prompt: `What date range should the ${topic} report cover?`,
    });

    // Step 2: Ask for format
    const { format } = await human({
      step: "format",
      prompt: "Which format do you prefer?",
      options: ["PDF", "Excel", "CSV"],
    });

    // Now generate the report with the collected data
    // const report = await generateReport(topic, startDate, endDate, format);
    return {
      report: `Generated ${format} report for "${topic}" (${startDate}–${endDate})`,
      downloadUrl: "/reports/latest",
    };
  },
});

export const ReportWizardTool = makeAssistantTool({
  ...reportWizardTool,
  toolName: "generate_report",

  render: ({ args, result, interrupt, resume }) => {
    // Step 1: date range
    if (interrupt?.payload.step === "date-range") {
      return <DateRangeStep prompt={interrupt.payload.prompt} onSubmit={resume} />;
    }

    // Step 2: format selection
    if (interrupt?.payload.step === "format") {
      return (
        <FormatStep
          prompt={interrupt.payload.prompt}
          options={interrupt.payload.options}
          onSelect={(format: string) => resume({ format })}
        />
      );
    }

    // Done
    if (result) {
      return (
        <div className="rounded-lg bg-blue-50 p-4">
          <p className="font-semibold text-blue-800">📊 {result.report}</p>
          <a
            href={result.downloadUrl}
            className="mt-2 inline-block text-sm text-blue-600 underline"
          >
            Download Report
          </a>
        </div>
      );
    }

    return <div className="text-sm text-gray-500">Preparing report wizard…</div>;
  },
});

// Helper sub-components
function DateRangeStep({
  prompt,
  onSubmit,
}: {
  prompt: string;
  onSubmit: (data: { startDate: string; endDate: string }) => void;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="mb-3 text-sm font-medium">{prompt}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          onSubmit({
            startDate: fd.get("start") as string,
            endDate: fd.get("end") as string,
          });
        }}
        className="flex flex-col gap-2"
      >
        <input type="date" name="start" className="rounded border p-1 text-sm" required />
        <input type="date" name="end" className="rounded border p-1 text-sm" required />
        <button
          type="submit"
          className="self-start rounded bg-blue-500 px-4 py-1.5 text-sm text-white hover:bg-blue-600"
        >
          Continue →
        </button>
      </form>
    </div>
  );
}

function FormatStep({
  prompt,
  options,
  onSelect,
}: {
  prompt: string;
  options: string[];
  onSelect: (format: string) => void;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="mb-3 text-sm font-medium">{prompt}</p>
      <div className="flex gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onSelect(opt)}
            className="rounded border px-4 py-2 text-sm hover:bg-gray-100"
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
```

### 7.2 Tool with streaming partial results

When a tool takes time and you want to show partial data as it arrives, use `useToolArgsFieldStatus`
to stream the input args while the tool call is still being constructed:

```tsx
// components/tools/DataAnalysisToolUI.tsx
"use client";

import { makeAssistantToolUI, useToolArgsFieldStatus } from "@assistant-ui/react";

type AnalysisArgs = { query: string; dataset: string };
type AnalysisResult = { insights: string[]; confidence: number };

function AnalysisForm({ args }: { args: Partial<AnalysisArgs> }) {
  const queryStatus = useToolArgsFieldStatus("query");
  const datasetStatus = useToolArgsFieldStatus("dataset");

  return (
    <div className="rounded-lg border bg-gray-50 p-4 text-sm">
      <div className={queryStatus === "complete" ? "text-gray-800" : "text-gray-400"}>
        📋 Query: {args.query ?? "…"}
      </div>
      <div className={datasetStatus === "complete" ? "text-gray-800" : "text-gray-400 mt-1"}>
        🗄 Dataset: {args.dataset ?? "…"}
      </div>
    </div>
  );
}

export const DataAnalysisToolUI = makeAssistantToolUI<AnalysisArgs, AnalysisResult>({
  toolName: "analyze_data",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <div>
          <AnalysisForm args={args} />
          <p className="mt-2 text-xs text-gray-500 animate-pulse">Analyzing…</p>
        </div>
      );
    }

    if (status.type === "complete" && result) {
      return (
        <div className="rounded-lg bg-indigo-50 p-4">
          <p className="font-semibold text-indigo-800">
            Analysis Complete ({Math.round(result.confidence * 100)}% confidence)
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm text-indigo-700">
            {result.insights.map((insight, i) => (
              <li key={i}>{insight}</li>
            ))}
          </ul>
        </div>
      );
    }

    return null;
  },
});
```

---

## 8. `createDeepAgent` & the Todo List

`createDeepAgent` is a beefed-up version of `createAgent`. It adds:
- **Planning** via a built-in `write_todos` tool — the agent breaks complex tasks into a todo list
- **File system** — the agent can read/write files for context management
- **Sub-agents** — the agent can spawn specialized sub-agents for specific sub-tasks
- **Context summarization** — automatically compresses old messages to keep within context limits

All of these are handled by the agent internally. From your API route, it looks almost identical.

### 8.1 Backend route with `createDeepAgent`

```typescript
// app/api/deep-agent/route.ts
import { toBaseMessages, toUIMessageStream } from "@ai-sdk/langchain";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { createDeepAgent } from "deepagents";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "langchain";
import { z } from "zod";

const model = new ChatOpenAI({ model: "gpt-4o", temperature: 0 });

// Custom tools your deep agent can use
const searchWeb = tool(
  async ({ query }: { query: string }) => {
    // Call your search API
    return `Results for: ${query}`;
  },
  {
    name: "search_web",
    description: "Search the web for current information",
    schema: z.object({ query: z.string() }),
  }
);

// createDeepAgent returns a compiled LangGraph graph — same interface as createAgent
const agent = createDeepAgent({
  model,
  tools: [searchWeb],
  systemPrompt: `You are a thorough research assistant.
Break large tasks into a to-do list using write_todos before starting.
Use search_web to find information.
Store findings in files using write_file.`,
  // Optional: define specialized sub-agents
  subagents: [
    {
      name: "researcher",
      description: "Does in-depth research on a specific topic",
      systemPrompt: "You are an expert researcher. Be thorough and cite sources.",
    },
    {
      name: "writer",
      description: "Writes and formats content based on research",
      systemPrompt: "You are an expert writer. Format content clearly and professionally.",
    },
  ],
});

export const maxDuration = 120; // deep agents can run longer

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const langchainMessages = await toBaseMessages(messages);

  // IMPORTANT: Use streamEvents() for both createAgent AND createDeepAgent.
  // The subgraphs option streams updates from sub-agents too.
  const streamEvents = agent.streamEvents(
    { messages: langchainMessages },
    {
      version: "v2",
      // Enable sub-agent streaming so the frontend can track sub-agent progress:
      subgraphs: true,
    }
  );

  return createUIMessageStreamResponse({
    stream: toUIMessageStream(streamEvents),
  });
}
```

### 8.2 The Todo List UI

The `write_todos` tool updates a `todos` key in the agent's LangGraph state. The cleanest way to
surface this in assistant-ui is through the `write_todos` tool UI — intercept it as a custom ToolUI.

The agent emits `write_todos` tool calls every time it updates the plan. You treat it just like any
other tool UI:

```tsx
// components/TodoPanel.tsx
"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { useState, useEffect } from "react";

export type Todo = {
  status: "pending" | "in_progress" | "completed";
  content: string;
};

// This component renders every time write_todos fires
export const WriteTodosToolUI = makeAssistantToolUI<
  { todos: Todo[] },
  null
>({
  toolName: "write_todos",
  render: ({ args }) => {
    // args.todos is the full updated todo list
    const todos = args.todos ?? [];
    const completed = todos.filter((t) => t.status === "completed").length;
    const percentage = todos.length ? Math.round((completed / todos.length) * 100) : 0;

    return (
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">📋 Agent Plan</h3>
          <span className="text-xs text-gray-400">
            {completed}/{todos.length} done
          </span>
        </div>

        {/* Progress bar */}
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-green-500 transition-all duration-500"
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* Todo items */}
        <ul className="space-y-2">
          {todos.map((todo, i) => (
            <TodoItem key={i} todo={todo} />
          ))}
        </ul>
      </div>
    );
  },
});

function TodoItem({ todo }: { todo: Todo }) {
  const styles = {
    pending: {
      container: "border-gray-100 bg-gray-50",
      icon: "○",
      iconColor: "text-gray-300",
      text: "text-gray-500",
    },
    in_progress: {
      container: "border-amber-200 bg-amber-50",
      icon: "◉",
      iconColor: "text-amber-500 animate-pulse",
      text: "text-amber-800 font-medium",
    },
    completed: {
      container: "border-green-200 bg-green-50",
      icon: "✓",
      iconColor: "text-green-500",
      text: "text-green-700 line-through",
    },
  };

  const s = styles[todo.status];

  return (
    <li className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${s.container}`}>
      <span className={`mt-0.5 select-none text-base leading-none ${s.iconColor}`}>
        {s.icon}
      </span>
      <span className={`text-sm ${s.text}`}>{todo.content}</span>
    </li>
  );
}
```

### 8.3 Persisting the todo list across messages

The problem with `makeAssistantToolUI` is that it only renders while the tool call is part of the
message history. For a persistent sidebar panel, maintain state at the page level:

```tsx
// app/deep-agent/page.tsx
"use client";

import { Thread } from "@/components/assistant-ui/thread";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { useState, useCallback } from "react";

type Todo = { status: "pending" | "in_progress" | "completed"; content: string };

export default function DeepAgentPage() {
  const [todos, setTodos] = useState<Todo[]>([]);

  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({ api: "/api/deep-agent" }),
  });

  // Create a tool UI that extracts todos and hoists them to page state
  const WriteTodosToolUI = useCallback(
    () =>
      makeAssistantToolUI<{ todos: Todo[] }, null>({
        toolName: "write_todos",
        render: ({ args }) => {
          // Side-effect: lift todos to page state so the sidebar stays updated
          if (args.todos) setTodos(args.todos);
          // Don't render anything inline in the chat — use the sidebar instead
          return null;
        },
      })(),
    [setTodos]
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <WriteTodosToolUI />

      <div className="flex h-dvh">
        {/* Sidebar — always visible, shows current plan */}
        {todos.length > 0 && (
          <aside className="w-72 shrink-0 overflow-y-auto border-r bg-gray-50 p-4">
            <TodoSidebar todos={todos} />
          </aside>
        )}

        {/* Main chat area */}
        <main className="flex-1">
          <Thread />
        </main>
      </div>
    </AssistantRuntimeProvider>
  );
}

function TodoSidebar({ todos }: { todos: Todo[] }) {
  const completed = todos.filter((t) => t.status === "completed").length;
  const percentage = todos.length ? Math.round((completed / todos.length) * 100) : 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-gray-700">Agent Plan</h2>
        <span className="text-xs text-gray-400">{percentage}%</span>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-700"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <ul className="space-y-2">
        {todos.map((todo, i) => (
          <li
            key={i}
            className={`rounded-lg p-2 text-xs ${
              todo.status === "completed"
                ? "text-gray-400 line-through"
                : todo.status === "in_progress"
                ? "font-medium text-amber-700"
                : "text-gray-500"
            }`}
          >
            {todo.status === "completed"
              ? "✓ "
              : todo.status === "in_progress"
              ? "◉ "
              : "○ "}
            {todo.content}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

> **Why `useCallback` here?** `makeAssistantToolUI` creates a React component. If you define it
> inside the render function without memoization, React recreates it on every render and re-mounts
> it, losing registration. Use `useCallback` or define it outside the component.

---

## 9. Streaming Custom Data from Tools

Your LangChain tools can emit custom progress events using `config.writer`. The `@ai-sdk/langchain`
adapter converts these into typed `data-{type}` parts on the message.

### 9.1 Backend tool with `config.writer`

```typescript
// app/api/agent/route.ts — tool with progress updates
import { tool, type ToolRuntime } from "langchain";
import { z } from "zod";

const analyzeDocument = tool(
  async (
    { documentId }: { documentId: string },
    config: ToolRuntime // the second param gives you config.writer
  ) => {
    const writer = config.writer;

    // Emit custom progress events — these arrive at the frontend as
    // message.parts of type "data-analysis-progress"
    writer?.({ type: "analysis-progress", step: "loading", progress: 0 });
    const doc = await loadDocument(documentId);

    writer?.({ type: "analysis-progress", step: "extracting", progress: 33 });
    const entities = await extractEntities(doc);

    writer?.({ type: "analysis-progress", step: "summarizing", progress: 66 });
    const summary = await summarize(doc);

    writer?.({ type: "analysis-progress", step: "done", progress: 100 });

    return { entities, summary, wordCount: doc.length };
  },
  {
    name: "analyze_document",
    description: "Deeply analyze a document",
    schema: z.object({ documentId: z.string() }),
  }
);
```

### 9.2 Frontend: reading custom data parts

```tsx
// components/tools/DocumentAnalysisToolUI.tsx
"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";

type AnalysisArgs = { documentId: string };
type AnalysisResult = { entities: string[]; summary: string; wordCount: number };

// Custom data events from config.writer arrive as message.parts with
// type "data-analysis-progress"
type ProgressData = {
  type: "analysis-progress";
  step: "loading" | "extracting" | "summarizing" | "done";
  progress: number;
};

export const DocumentAnalysisToolUI = makeAssistantToolUI<AnalysisArgs, AnalysisResult>({
  toolName: "analyze_document",
  render: ({ args, result, status }) => {
    // For custom data, you read it from the message context
    // The data parts appear alongside this tool call in the message

    if (status.type === "running") {
      return (
        <div className="rounded-lg border bg-purple-50 p-4">
          <p className="text-sm font-medium text-purple-800">
            🔍 Analyzing document: {args.documentId}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-purple-200">
            {/* The progress bar — in a real implementation, you'd read from
                the data parts on the parent message using useMessage() */}
            <div className="h-full w-2/3 animate-pulse rounded-full bg-purple-500" />
          </div>
        </div>
      );
    }

    if (status.type === "complete" && result) {
      return (
        <div className="rounded-lg border bg-purple-50 p-4">
          <p className="font-semibold text-purple-800">
            📄 Analysis Complete ({result.wordCount} words)
          </p>
          <p className="mt-2 text-sm text-gray-700">{result.summary}</p>
          {result.entities.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500">Entities found:</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {result.entities.map((e) => (
                  <span key={e} className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    return null;
  },
});
```

---

## 10. Multi-Step Agent Loops

By default, the agent runs until it decides it's done (which for `createDeepAgent` can be many
steps). For `createAgent` with the AI SDK's `streamText`, you use `stopWhen`:

```typescript
// app/api/agent/route.ts
import { streamText, convertToModelMessages, stepCountIs, tool, zodSchema } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai("gpt-4o"),
    messages: await convertToModelMessages(messages),
    tools: {
      get_weather: tool({
        description: "Get the current weather",
        inputSchema: zodSchema(z.object({ city: z.string() })),
        execute: async ({ city }) => `${city}: 22°C, sunny`,
      }),
    },
    // Run up to 10 tool-call rounds before stopping
    stopWhen: stepCountIs(10),
  });

  return result.toUIMessageStreamResponse();
}
```

> **For `createAgent` / `createDeepAgent`**: The agent itself manages its own loop — it keeps
> calling tools until it decides it's done. You don't need `stopWhen`. The agent is the loop.

---

## 11. Persisting Chat History

By default, messages live only in memory and are lost on page reload. To persist history, implement
a `ThreadHistoryAdapter`.

**IMPORTANT:** With `useChatRuntime` (AI SDK path), your adapter **must** implement `withFormat`.
The `load` and `append` at the top level are unused — assistant-ui only calls `withFormat(fmt).*`.

```tsx
// lib/historyAdapter.ts
import type { ThreadHistoryAdapter } from "@assistant-ui/react";

export const historyAdapter: ThreadHistoryAdapter = {
  // These are required by TypeScript but unused by useChatRuntime
  async load() { return { headId: null, messages: [] }; },
  async append() {},

  // THIS is what useChatRuntime actually calls
  withFormat: (fmt) => ({
    async load() {
      // Fetch stored messages from your database / API
      const res = await fetch("/api/history");
      if (!res.ok) return { messages: [] };
      const rows = await res.json();
      // fmt.decode() converts your stored row back into a UIMessage
      return { messages: rows.map(fmt.decode) };
    },

    async append(item) {
      // item.message is the UIMessage to save
      await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: fmt.getId(item.message),
          parent_id: item.parentId,
          format: fmt.format,         // e.g. "ai-sdk/v6"
          content: fmt.encode(item),  // the serialized message
        }),
      });
    },
  }),
};
```

```typescript
// app/api/history/route.ts — simple in-memory store (replace with a real DB)
let stored: any[] = [];

export async function GET() {
  return Response.json(stored);
}

export async function POST(req: Request) {
  const row = await req.json();
  stored = [...stored.filter((r) => r.id !== row.id), row]; // upsert
  return Response.json({ ok: true });
}
```

```tsx
// app/page.tsx — wire up the history adapter
const runtime = useChatRuntime({
  transport: new AssistantChatTransport({ api: "/api/agent" }),
  adapters: { history: historyAdapter },
});
```

---

## 12. Token Usage Display

Show users how many tokens they've used. The server attaches `usage` data via `messageMetadata`,
and the client reads it with `useThreadTokenUsage`:

```typescript
// app/api/agent/route.ts — attach token metadata
// NOTE: This approach works with streamText (AI SDK tools).
// For createAgent/createDeepAgent, token data is embedded in streamEvents
// and forwarded automatically by toUIMessageStream.
return result.toUIMessageStreamResponse({
  messageMetadata: ({ part }) => {
    if (part.type === "finish") {
      return { usage: part.totalUsage };
    }
    if (part.type === "finish-step") {
      return { modelId: part.response.modelId };
    }
    return undefined;
  },
});
```

```tsx
// components/TokenCounter.tsx
"use client";

import { useThreadTokenUsage } from "@assistant-ui/react-ai-sdk";

export function TokenCounter() {
  const usage = useThreadTokenUsage();
  if (!usage) return null;

  return (
    <div className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
      <span>🔢</span>
      <span>{usage.promptTokens?.toLocaleString() ?? 0} in</span>
      <span>·</span>
      <span>{usage.completionTokens?.toLocaleString() ?? 0} out</span>
      <span>·</span>
      <span className="font-medium text-gray-700">
        {usage.totalTokens?.toLocaleString() ?? 0} total
      </span>
    </div>
  );
}
```

---

## 13. Environment Variables & Project Structure

### `.env.local`

```bash
# LLM provider
OPENAI_API_KEY=sk-...

# Optional: tracing (doesn't require LangSmith deployment)
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=ls__...
LANGSMITH_PROJECT=my-agent-app
```

### Recommended file structure

```
my-agent-app/
├── app/
│   ├── api/
│   │   ├── agent/
│   │   │   └── route.ts          ← createAgent backend
│   │   ├── deep-agent/
│   │   │   └── route.ts          ← createDeepAgent backend
│   │   └── history/
│   │       └── route.ts          ← optional history persistence
│   ├── page.tsx                   ← basic agent page
│   └── deep-agent/
│       └── page.tsx               ← deep agent page with todo sidebar
│
├── components/
│   ├── assistant-ui/
│   │   └── thread.tsx             ← generated by `npx assistant-ui add thread`
│   ├── tools/
│   │   ├── WeatherToolUI.tsx      ← server tool UI (makeAssistantToolUI)
│   │   ├── SearchToolUI.tsx
│   │   ├── ConfirmPaymentTool.tsx ← HITL client tool (makeAssistantTool)
│   │   ├── ReportWizardTool.tsx   ← multi-step client tool
│   │   └── WriteTodosToolUI.tsx   ← deep agent todo UI
│   └── TokenCounter.tsx
│
├── lib/
│   ├── agents.ts                  ← your agent definitions (createAgent / createDeepAgent)
│   ├── tools.ts                   ← reusable LangChain tool definitions
│   └── historyAdapter.ts          ← ThreadHistoryAdapter implementation
│
└── .env.local
```

> **Pro tip:** Put your `createAgent` and `createDeepAgent` calls in `lib/agents.ts` and import
> them into the route handlers. This keeps routes thin and makes agents easy to test in isolation.

---

## 14. Common Mistakes & How to Avoid Them

### ❌ Mistake 1: Using `agent.stream()` instead of `agent.streamEvents()`

```typescript
// ❌ WRONG — causes "content is not iterable" runtime error with createAgent
const stream = await agent.stream({ messages }, { streamMode: ["values", "messages"] });
return createUIMessageStreamResponse({ stream: toUIMessageStream(stream) });

// ✅ CORRECT — use streamEvents for createAgent and createDeepAgent
const streamEvents = agent.streamEvents({ messages }, { version: "v2" });
return createUIMessageStreamResponse({ stream: toUIMessageStream(streamEvents) });
```

**Why?** `createAgent` produces a different event structure than a raw `StateGraph`. `streamEvents`
gives granular semantic events that `toUIMessageStream` knows how to parse.

---

### ❌ Mistake 2: Forgetting `await` on `toBaseMessages`

```typescript
// ❌ WRONG — toBaseMessages is async in AI SDK v6
const langchainMessages = toBaseMessages(messages);

// ✅ CORRECT
const langchainMessages = await toBaseMessages(messages);
```

---

### ❌ Mistake 3: Calling `useChat` yourself alongside `useChatRuntime`

```tsx
// ❌ WRONG — you end up with two parallel chat state managers fighting each other
const chat = useChat({ api: "/api/agent" });
const runtime = useChatRuntime({ ... });

// ✅ CORRECT — just use useChatRuntime, it calls useChat for you
const runtime = useChatRuntime({
  transport: new AssistantChatTransport({ api: "/api/agent" }),
});
```

---

### ❌ Mistake 4: Defining `makeAssistantToolUI` inside a render function

```tsx
// ❌ WRONG — React unmounts and remounts the tool on every render, losing registration
function MyPage() {
  const MyTool = makeAssistantToolUI({ toolName: "myTool", render: () => ... }); // ← BUG
  return <MyTool />;
}

// ✅ CORRECT — define outside the component (or use useMemo/useCallback)
const MyTool = makeAssistantToolUI({ toolName: "myTool", render: () => ... });

function MyPage() {
  return <MyTool />;
}
```

---

### ❌ Mistake 5: Missing `withFormat` in your history adapter

```typescript
// ❌ WRONG — useChatRuntime will throw "withFormat is required" at runtime
const historyAdapter = {
  async load() { /* ... */ },
  async append() { /* ... */ },
};

// ✅ CORRECT — always implement withFormat
const historyAdapter = {
  async load() { return { headId: null, messages: [] }; },
  async append() {},
  withFormat: (fmt) => ({
    async load() { /* decode rows */ },
    async append(item) { /* encode and save */ },
  }),
};
```

---

### ❌ Mistake 6: Not setting `maxDuration` on long-running agent routes

```typescript
// ❌ WRONG — Vercel/Next.js default timeout is 10s, deep agents can take minutes
export async function POST(req: Request) { ... }

// ✅ CORRECT — always set maxDuration for agent routes
export const maxDuration = 120; // seconds
export async function POST(req: Request) { ... }
```

---

### ❌ Mistake 7: Using `toDataStreamResponse()` instead of `toUIMessageStreamResponse()`

```typescript
// ❌ WRONG — toDataStreamResponse is AI SDK v4 / v5. In v6 it's gone.
return result.toDataStreamResponse();

// ✅ CORRECT — AI SDK v6
return result.toUIMessageStreamResponse();
// or for createAgent:
return createUIMessageStreamResponse({ stream: toUIMessageStream(streamEvents) });
```

---

## Quick Reference

| You want to... | Use this |
|---|---|
| Display a tool that runs on the server | `makeAssistantToolUI` |
| Define + display a tool that runs on the client | `makeAssistantTool` |
| Pause the agent and ask the user something | `human()` in `makeAssistantTool` + `resume()` in the render |
| Native AI SDK approval for a server tool | `needsApproval: true` on the `tool()` definition |
| Show the deepAgent todo plan | `makeAssistantToolUI` for `write_todos` |
| Hoist todos to a persistent sidebar | `useState` at page level, set it inside the toolName render |
| Stream progress from inside a tool | `config.writer({ ... })` in the tool + read from message parts |
| Persist chat history | `historyAdapter` with `withFormat` passed to `useChatRuntime` |
| Show token usage | `useThreadTokenUsage` from `@assistant-ui/react-ai-sdk` |
| Run multiple tool-call rounds (AI SDK path) | `stopWhen: stepCountIs(N)` in `streamText` |
| Convert messages: frontend → LangChain | `await toBaseMessages(messages)` |
| Convert stream: LangChain → frontend | `toUIMessageStream(streamEvents)` |

---

*Built with: `deepagents` · `@ai-sdk/langchain` · `@assistant-ui/react` · Next.js App Router*
