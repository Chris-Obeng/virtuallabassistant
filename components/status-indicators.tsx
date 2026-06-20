"use client";

import { AuiIf } from "@assistant-ui/react";
import { Loader2, Sparkles, Volume2 } from "lucide-react";
import { useState, useEffect } from "react";

/**
 * Thinking indicator — shows when the assistant is generating a response.
 * Renders as a subtle animated dots indicator under the last assistant message.
 */
export function ThinkingIndicator() {
  return (
    <AuiIf condition={(s) => s.thread.isRunning}>
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="flex items-center gap-1">
          Thinking
          <span className="inline-flex">
            <span className="animate-bounce delay-0">.</span>
            <span className="animate-bounce delay-150">.</span>
            <span className="animate-bounce delay-300">.</span>
          </span>
        </span>
      </div>
    </AuiIf>
  );
}

/**
 * Speaking indicator — shows when TTS audio is playing.
 * Can be triggered via a custom event from audio playback components.
 */
export function SpeakingIndicator() {
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    const start = () => setIsSpeaking(true);
    const stop = () => setIsSpeaking(false);

    window.addEventListener("tts-playback-start", start);
    window.addEventListener("tts-playback-end", stop);

    return () => {
      window.removeEventListener("tts-playback-start", start);
      window.removeEventListener("tts-playback-end", stop);
    };
  }, []);

  if (!isSpeaking) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400 animate-in fade-in slide-in-from-bottom-1 duration-200">
      <Volume2 className="size-4" />
      <span>Speaking</span>
      <span className="flex items-center gap-0.5">
        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse delay-150" />
        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse delay-300" />
      </span>
    </div>
  );
}

/**
 * Combined status bar — shows the current assistant state.
 * Place this below the composer or in the thread viewport footer.
 */
export function AssistantStatusBar() {
  const [status, setStatus] = useState<"idle" | "thinking" | "speaking" | "listening">("idle");

  useEffect(() => {
    const handleThinkingStart = () => setStatus("thinking");
    const handleThinkingEnd = () => {
      // Don't immediately go to idle - check if speaking
      setStatus((prev) => (prev === "thinking" ? "idle" : prev));
    };
    const handleSpeakingStart = () => setStatus("speaking");
    const handleSpeakingEnd = () => setStatus("idle");
    const handleListeningStart = () => setStatus("listening");
    const handleListeningEnd = () => setStatus("idle");

    window.addEventListener("thread-run-start", handleThinkingStart);
    window.addEventListener("thread-run-end", handleThinkingEnd);
    window.addEventListener("tts-playback-start", handleSpeakingStart);
    window.addEventListener("tts-playback-end", handleSpeakingEnd);
    window.addEventListener("voice-recording-start", handleListeningStart);
    window.addEventListener("voice-recording-end", handleListeningEnd);

    return () => {
      window.removeEventListener("thread-run-start", handleThinkingStart);
      window.removeEventListener("thread-run-end", handleThinkingEnd);
      window.removeEventListener("tts-playback-start", handleSpeakingStart);
      window.removeEventListener("tts-playback-end", handleSpeakingEnd);
      window.removeEventListener("voice-recording-start", handleListeningStart);
      window.removeEventListener("voice-recording-end", handleListeningEnd);
    };
  }, []);

  if (status === "idle") return null;

  const configs = {
    thinking: {
      icon: Loader2,
      label: "Thinking",
      color: "text-muted-foreground",
      animate: "animate-spin",
    },
    speaking: {
      icon: Volume2,
      label: "Speaking",
      color: "text-emerald-600 dark:text-emerald-400",
      animate: "animate-pulse",
    },
    listening: {
      icon: Sparkles,
      label: "Listening",
      color: "text-red-500",
      animate: "animate-pulse",
    },
  };

  const cfg = configs[status];
  const Icon = cfg.icon;

  return (
    <div
      className={`flex items-center gap-2 px-4 py-1.5 text-sm ${cfg.color} animate-in fade-in slide-in-from-bottom-1 duration-200`}
    >
      <Icon className={`size-4 ${cfg.animate}`} />
      <span className="font-medium">{cfg.label}</span>
      <span className="flex items-center gap-0.5">
        <span className="size-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="size-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="size-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "300ms" }} />
      </span>
    </div>
  );
}
