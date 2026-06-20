"use client";

import { Thread } from "@/components/thread";
import { ThreadListSidebar } from "@/components/threadlist-sidebar";
import Header from "@/components/custom/header";
import { InstrumentConfirmationGates } from "@/components/confirmation-gate";
import { DeepgramVoiceAdapter } from "@/lib/deepgram-voice-adapter";
import {
  AssistantRuntimeProvider,
  useRemoteThreadListRuntime,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  WebSpeechSynthesisAdapter,
} from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { threadListAdapter } from "@/components/chat-provider";

export default function Home() {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () =>
      useChatRuntime({
        transport: new AssistantChatTransport({
          api: "/api/agent",
          fetch: async (url, init) => {
            const body = JSON.parse(init!.body as string);
            body.messages = [body.messages[body.messages.length - 1]];
            return fetch(url, { ...init, body: JSON.stringify(body) });
          },
        }),
        adapters: {
          speech: new WebSpeechSynthesisAdapter(),
          voice: new DeepgramVoiceAdapter(),
          attachments: new CompositeAttachmentAdapter([
            new SimpleImageAttachmentAdapter(),
            new SimpleTextAttachmentAdapter(),
          ]),
        },
      }),
    adapter: threadListAdapter,
  });

  return (
    <TooltipProvider>
      <AssistantRuntimeProvider runtime={runtime}>
        <InstrumentConfirmationGates />
        <SidebarProvider defaultOpen={false}>
          <div className="flex h-screen w-full overflow-hidden">
            <ThreadListSidebar />
            <SidebarInset className="flex flex-col h-full overflow-hidden relative">
              <Header />
              <Thread />
            </SidebarInset>
          </div>
        </SidebarProvider>
      </AssistantRuntimeProvider>
    </TooltipProvider>
  );
}
