"use client";

import { Thread } from "@/components/thread";
import { ThreadListSidebar } from "@/components/threadlist-sidebar";
import Header from "@/components/custom/header";
import { InstrumentToolkit } from "@/components/tool-ui";
import { DeepgramVoiceAdapter } from "@/lib/deepgram-voice-adapter";
import { useUser, SignInButton, SignUpButton } from "@clerk/nextjs";
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
import { Button } from "@/components/ui/button";
import { threadListAdapter } from "@/components/chat-provider";
import { Sparkles } from "lucide-react";

export default function Home() {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return <LoadingSkeleton />;
  }

  if (!isSignedIn) {
    return <LandingPage />;
  }

  return <ChatApp />;
}

function LoadingSkeleton() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="size-8 animate-spin rounded-full border-2 border-black border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function LandingPage() {
  return (
    <TooltipProvider>
      <div className="flex h-screen w-full flex-col bg-background">
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 h-14 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-black text-white">
              <Sparkles className="size-4" />
            </div>
            <span className="font-semibold text-lg tracking-tight">Virtual Lab Assistant</span>
          </div>
          <div className="flex items-center gap-2">
            <SignInButton mode="modal">
              <Button variant="ghost" className="rounded-full font-medium text-sm sm:text-base h-9 sm:h-10 px-4 cursor-pointer">
                Sign In
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button className="bg-black text-white hover:bg-gray-800 rounded-full font-medium text-sm sm:text-base h-9 sm:h-10 px-4 sm:px-5 shadow-sm transition-all duration-200 cursor-pointer">
                Sign Up
              </Button>
            </SignUpButton>
          </div>
        </header>
        <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <div className="mx-auto max-w-lg">
            <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-black text-white mx-auto">
              <Sparkles className="size-8" />
            </div>
            <h1 className="mb-3 font-bold text-3xl sm:text-4xl tracking-tight">
              Virtual Lab Assistant
            </h1>
            <p className="mb-8 text-muted-foreground text-lg">
              An AI-powered lab companion for electrical engineering students. Get measurement guidance, configure virtual instruments, and learn lab procedures — all through conversation.
            </p>
            <div className="flex items-center justify-center gap-3">
              <SignInButton mode="modal">
                <Button className="bg-black text-white hover:bg-gray-800 rounded-full font-medium px-6 py-5 text-base cursor-pointer">
                  Sign in to get started
                </Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button variant="outline" className="rounded-full font-medium px-6 py-5 text-base cursor-pointer">
                  Create account
                </Button>
              </SignUpButton>
            </div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

function ChatApp() {
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
        <InstrumentToolkit />
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
