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
import Image from "next/image";
import {
  Microscope,
  MessageSquareText,
  Waves,
} from "lucide-react";

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
    <div className="flex h-screen w-full items-center justify-center bg-[#f5f5f7] dark:bg-black">
      <div className="flex flex-col items-center gap-4">
        <div className="size-8 animate-spin rounded-full border-2 border-[#1d1d1f] border-t-transparent" />
        <p className="text-sm text-[#86868b] font-medium">Loading...</p>
      </div>
    </div>
  );
}

function LandingPage() {
  return (
    <TooltipProvider>
      <div className="flex h-screen w-full flex-col bg-[#f5f5f7] overflow-hidden">
        {/* Minimal nav bar */}
        <header className="flex items-center justify-between px-6 sm:px-10 py-4 h-14 shrink-0">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="Virtual Lab Assistant"
              width={32}
              height={32}
              className="rounded-lg object-contain"
            />
            <span className="font-semibold text-[15px] tracking-tight text-[#1d1d1f]">
              Virtual Lab Assistant
            </span>
          </div>
          <div className="flex items-center gap-2">
            <SignInButton mode="modal">
              <Button
                variant="ghost"
                className="rounded-full font-medium text-sm h-9 px-5 cursor-pointer text-[#1d1d1f] hover:bg-[#e8e8ed] transition-all duration-200"
              >
                Sign In
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button className="bg-[#1d1d1f] text-white hover:bg-black rounded-full font-medium text-sm h-9 px-5 shadow-sm transition-all duration-200 cursor-pointer">
                Sign Up
              </Button>
            </SignUpButton>
          </div>
        </header>

        {/* Hero section */}
        <main className="flex flex-1 flex-col items-center justify-center px-6 text-center relative">
          {/* Subtle background gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#e8e8ed]/50 via-transparent to-transparent pointer-events-none" />

          <div className="mx-auto max-w-2xl relative z-10">
            {/* Logo */}
            <div className="mb-8 mx-auto flex items-center justify-center">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-b from-[#1d1d1f]/5 to-transparent rounded-3xl blur-xl" />
                <Image
                  src="/logo.png"
                  alt="Virtual Lab Assistant"
                  width={96}
                  height={96}
                  className="rounded-[22px] object-contain relative shadow-sm"
                />
              </div>
            </div>

            {/* Headline */}
            <h1 className="mb-4 font-bold text-[40px] sm:text-[56px] leading-[1.05] tracking-tight text-[#1d1d1f]">
              Your Intelligent
              <br />
              <span className="bg-gradient-to-r from-[#1d1d1f] to-[#555559] bg-clip-text text-transparent">
                Lab Companion
              </span>
            </h1>

            {/* Subtitle */}
            <p className="mb-10 text-[#86868b] text-lg sm:text-xl max-w-lg mx-auto leading-relaxed font-normal">
              An AI-powered lab assistant for electrical engineering students.
              Get measurement guidance, configure instruments, and learn lab
              procedures through natural conversation.
            </p>

            {/* CTA buttons */}
            <div className="flex items-center justify-center gap-3">
              <SignInButton mode="modal">
                <Button className="bg-[#1d1d1f] text-white hover:bg-black rounded-full font-medium px-8 py-5 text-[15px] shadow-sm transition-all duration-200 hover:shadow-md active:scale-[0.98] cursor-pointer">
                  Get Started
                  <svg
                    className="ml-2 size-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13 7l5 5m0 0l-5 5m5-5H6"
                    />
                  </svg>
                </Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button
                  variant="outline"
                  className="rounded-full font-medium px-8 py-5 text-[15px] border-[#d2d2d7] text-[#1d1d1f] hover:bg-[#e8e8ed] transition-all duration-200 active:scale-[0.98] cursor-pointer"
                >
                  Create Account
                </Button>
              </SignUpButton>
            </div>

            {/* Feature highlights */}
            <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
              {[
                {
                  icon: Microscope,
                  title: "Lab Guidance",
                  desc: "Step-by-step measurement procedures and instrument configuration.",
                },
                {
                  icon: MessageSquareText,
                  title: "Natural Chat",
                  desc: "Ask questions in plain language and get instant, accurate answers.",
                },
                {
                  icon: Waves,
                  title: "Voice Mode",
                  desc: "Speak naturally — the assistant transcribes and responds in real time.",
                },
              ].map((feature) => (
                <div
                  key={feature.title}
                  className="group rounded-2xl bg-white/70 backdrop-blur-xl border border-[#d2d2d7]/50 p-5 transition-all duration-300 hover:bg-white hover:border-[#d2d2d7] hover:shadow-sm"
                >
                  <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-[#f5f5f7] group-hover:bg-[#e8e8ed] transition-colors">
                    <feature.icon className="size-5 text-[#1d1d1f]" />
                  </div>
                  <h3 className="font-semibold text-[15px] text-[#1d1d1f] mb-1">
                    {feature.title}
                  </h3>
                  <p className="text-[13px] text-[#86868b] leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
              ))}
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
