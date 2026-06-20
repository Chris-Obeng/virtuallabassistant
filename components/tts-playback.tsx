"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Volume2, StopCircle, Loader2 } from "lucide-react";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { MessagePrimitive, useAuiState } from "@assistant-ui/react";

type PlayState = "idle" | "loading" | "playing" | "error";

/**
 * Per-message Deepgram TTS play button.
 * Renders inside an assistant message context.
 * Fetches the message text, sends it to /api/voice/tts, and plays the audio.
 */
export function DeepgramPlayButton() {
  const [playState, setPlayState] = useState<PlayState>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messageText = useAuiState((s) => {
    // Collect all text content parts from the current message
    return s.message.parts
      .filter((p: any) => p.type === "text")
      .map((p: any) => (typeof p.text === "string" ? p.text : ""))
      .join("\n");
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const handlePlay = useCallback(async () => {
    if (!messageText || messageText.trim().length === 0) return;

    // If already playing, stop
    if (playState === "playing") {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      window.dispatchEvent(new CustomEvent("tts-playback-end"));
      setPlayState("idle");
      return;
    }

    setPlayState("loading");

    try {
      const response = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: messageText }),
      });

      if (!response.ok) {
        throw new Error(`TTS failed: ${response.statusText}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        window.dispatchEvent(new CustomEvent("tts-playback-end"));
        setPlayState("idle");
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        window.dispatchEvent(new CustomEvent("tts-playback-end"));
        setPlayState("error");
        setTimeout(() => setPlayState("idle"), 2000);
      };

      window.dispatchEvent(new CustomEvent("tts-playback-start"));
      setPlayState("playing");
      await audio.play();
    } catch (err) {
      console.error("[TTS Playback] Error:", err);
      window.dispatchEvent(new CustomEvent("tts-playback-end"));
      setPlayState("error");
      setTimeout(() => setPlayState("idle"), 2000);
    }
  }, [messageText, playState]);

  // Don't render if no text content
  if (!messageText || messageText.trim().length === 0) return null;

  return (
    <TooltipIconButton
      tooltip={playState === "playing" ? "Stop Deepgram audio" : "Play with Deepgram"}
      aria-label={playState === "playing" ? "Stop audio" : "Play audio"}
      onClick={handlePlay}
    >
      {playState === "loading" ? (
        <Loader2 className="size-4 animate-spin" />
      ) : playState === "playing" ? (
        <StopCircle className="size-4 text-emerald-500" />
      ) : playState === "error" ? (
        <Volume2 className="size-4 text-destructive" />
      ) : (
        <Volume2 className="size-4" />
      )}
    </TooltipIconButton>
  );
}
