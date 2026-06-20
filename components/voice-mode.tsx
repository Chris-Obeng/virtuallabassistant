"use client";

import { useState, useRef, useCallback, useEffect, type FC } from "react";
import {
  useVoiceControls,
  useVoiceState,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { VoiceOrb, deriveVoiceOrbState } from "@/components/assistant-ui/voice";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Mic,
  Volume2,
  Loader2,
  Sparkles,
  PhoneOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

type VoiceModeState = "idle" | "listening" | "thinking" | "speaking";

/**
 * Voice Mode toggle — the main entry point for hands-free voice chat.
 * Sits above the composer. When active, shows a VoiceOrb and state indicator.
 */
export const VoiceModeToggle: FC = () => {
  const voiceState = useVoiceState();
  const { connect, disconnect, mute, unmute } = useVoiceControls();
  const aui = useAui();
  const isRunning = useAuiState((s: any) => s.thread.isRunning);

  const orbState = deriveVoiceOrbState(voiceState);

  const isConnected = voiceState?.status.type === "running";

  const [voiceModeState, setVoiceModeState] =
    useState<VoiceModeState>("idle");
  const [isVoiceMode, setIsVoiceMode] = useState(false);

  // Derived state from voice + thread state
  useEffect(() => {
    if (!isConnected || !isVoiceMode) {
      setVoiceModeState("idle");
      return;
    }
    if (orbState === "speaking") {
      setVoiceModeState("speaking");
    } else if (isRunning) {
      setVoiceModeState("thinking");
    } else if (orbState === "listening") {
      setVoiceModeState("listening");
    } else {
      setVoiceModeState("listening");
    }
  }, [isConnected, orbState, isRunning, isVoiceMode]);

  // Track thread runs for TTS auto-play
  const lastRunIdRef = useRef<string | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  // Detect confirmation gate — only checks the LAST assistant message
  // so the flag resets once the user confirms or the agent continues
  const hasPendingConfirmation = useAuiState(
    useCallback((s: any) => {
      const msgs = s.thread.messages;
      if (!msgs || msgs.length === 0) return false;
      const lastMsg = msgs[msgs.length - 1];
      if (!lastMsg || lastMsg.role !== "assistant") return false;
      return lastMsg.content?.some((p: any) => {
        if (p.type !== "tool-call" || !p.result) return false;
        // Handle both string (from LangChain) and parsed object cases
        if (typeof p.result === "string") {
          return p.result.includes('"requiresConfirmation"');
        }
        if (typeof p.result === "object") {
          return (p.result as any).requiresConfirmation === true;
        }
        return false;
      });
    }, []),
  );

  // Auto-play TTS when response completes (Voice Mode only)
  // Only plays text parts — skips tool calls and machine-readable results
  const messages = useAuiState(
    useCallback((s: any) => s.thread.messages, []),
  );

  const isTTSPlayingRef = useRef(false);

  useEffect(() => {
    if (!isVoiceMode || messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role !== "assistant") return;
    if (lastMsg?.status?.type !== "complete") return;
    if (lastRunIdRef.current === lastMsg.id) return;

    lastRunIdRef.current = lastMsg.id;

    // Extract text content — exclude tool calls and machine-readable blocks
    const textParts = (lastMsg.content ?? [])
      .filter(
        (p: any) =>
          p.type === "text" &&
          typeof p.text === "string" &&
          !p.text.startsWith("{") &&  // skip JSON (tool results that leaked into text)
          !p.text.startsWith("[{"),
      )
      .map((p: any) => p.text)
      .join("\n")
      .trim();

    if (!textParts || textParts.length === 0) return;

    // Don't auto-play if there's a pending confirmation — let the user respond first
    if (hasPendingConfirmation) return;

    // Mute mic during TTS playback (prevents barge-in)
    mute();
    setVoiceModeState("speaking");

    fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: textParts }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("TTS failed");
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        ttsAudioRef.current = audio;

        window.dispatchEvent(new CustomEvent("tts-playback-start"));

        audio.onended = () => {
          URL.revokeObjectURL(url);
          isTTSPlayingRef.current = false;
          window.dispatchEvent(new CustomEvent("tts-playback-end"));
          // Re-arm: unmute mic so listening resumes
          unmute();
          setVoiceModeState("listening");
          ttsAudioRef.current = null;
        };

        audio.onerror = () => {
          URL.revokeObjectURL(url);
          isTTSPlayingRef.current = false;
          window.dispatchEvent(new CustomEvent("tts-playback-end"));
          unmute();
          setVoiceModeState("listening");
          ttsAudioRef.current = null;
        };

        isTTSPlayingRef.current = true;
        audio.play().catch(() => {
          isTTSPlayingRef.current = false;
          unmute();
          setVoiceModeState("listening");
        });
      })
      .catch((err) => {
        console.error("[VoiceMode] TTS error:", err);
        unmute();
        setVoiceModeState("listening");
      });
  }, [messages, isVoiceMode, hasPendingConfirmation, mute, unmute]);

  // Mute mic during confirmation gate pauses
  useEffect(() => {
    if (!isVoiceMode || !isConnected) return;
    if (hasPendingConfirmation && !isTTSPlayingRef.current) {
      mute();
    } else if (!hasPendingConfirmation) {
      // Only unmute if we're not currently playing TTS
      if (!isTTSPlayingRef.current) {
        unmute();
      }
    }
  }, [hasPendingConfirmation, isVoiceMode, isConnected, mute, unmute]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
    };
  }, []);

  const handleToggle = useCallback(() => {
    if (isVoiceMode) {
      // Exit Voice Mode
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
      isTTSPlayingRef.current = false;
      window.dispatchEvent(new CustomEvent("tts-playback-end"));
      unmute();
      disconnect();
      setIsVoiceMode(false);
      setVoiceModeState("idle");
    } else {
      // Enter Voice Mode
      setIsVoiceMode(true);
      connect();
    }
  }, [isVoiceMode, disconnect, connect, unmute]);

  const stateLabel: Record<VoiceModeState, string> = {
    idle: "Voice Mode",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
  };

  const stateIcon: Record<VoiceModeState, typeof Mic> = {
    idle: Mic,
    listening: Sparkles,
    thinking: Loader2,
    speaking: Volume2,
  };

  const StateIcon = stateIcon[voiceModeState];

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Voice Mode toggle button */}
      <Button
        variant={isVoiceMode ? "default" : "outline"}
        size="sm"
        className={cn(
          "gap-2 rounded-full transition-all shrink-0",
          isVoiceMode && "bg-emerald-600 hover:bg-emerald-700 text-white",
          voiceModeState === "listening" && "animate-pulse",
        )}
        onClick={handleToggle}
      >
        {isVoiceMode ? (
          <>
            <PhoneOff className="size-4" />
            Exit
          </>
        ) : (
          <>
            <Mic className="size-4" />
            Voice Mode
          </>
        )}
      </Button>

      {/* State indicator */}
      {isVoiceMode && (
        <div className="flex items-center gap-2 min-w-0">
          <VoiceOrb variant="emerald" className="size-8 shrink-0" />
          <Badge
            variant={
              voiceModeState === "speaking"
                ? "default"
                : voiceModeState === "thinking"
                  ? "secondary"
                  : "outline"
            }
            className={cn(
              "gap-1.5 px-2.5 py-1 text-xs font-medium whitespace-nowrap",
              voiceModeState === "listening" &&
                "border-emerald-500 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300",
              voiceModeState === "speaking" &&
                "border-blue-500 text-blue-700 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-300",
            )}
          >
            <StateIcon
              className={cn(
                "size-3",
                voiceModeState === "thinking" && "animate-spin",
                voiceModeState === "listening" && "animate-pulse",
              )}
            />
            {stateLabel[voiceModeState]}
          </Badge>

          {hasPendingConfirmation && (
            <Badge
              variant="destructive"
              className="gap-1.5 px-2.5 py-1 text-xs whitespace-nowrap"
            >
              ⏸ Confirmation
            </Badge>
          )}
        </div>
      )}
    </div>
  );
};
