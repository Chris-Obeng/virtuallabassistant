"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { useAui } from "@assistant-ui/react";

type RecordingState = "idle" | "recording" | "processing" | "error";

export function MicButton() {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const aui = useAui();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const handleStartRecording = useCallback(async () => {
    try {
      setErrorMessage(null);
      chunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/webm;codecs=opus",
      });

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecordingState("processing");

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });

        try {
          const response = await fetch("/api/voice/stt", {
            method: "POST",
            body: blob,
          });

          if (!response.ok) {
            const err = await response.json().catch(() => ({ error: "Transcription failed" }));
            throw new Error(err.error || "Transcription failed");
          }

          const data = await response.json();

          if (data.transcript && data.transcript.trim().length > 0) {
            // Insert directly into the composer by appending as a user message
            // This reuses the existing submit path without DOM manipulation
            aui.thread().append({
              role: "user",
              content: [{ type: "text", text: data.transcript.trim() }],
            });
            setRecordingState("idle");
          } else {
            setRecordingState("idle");
            setErrorMessage("No speech detected. Please try again.");
            setTimeout(() => setErrorMessage(null), 3000);
          }
        } catch (err) {
          console.error("[MicButton] STT error:", err);
          setRecordingState("error");
          setErrorMessage("Transcription failed. Please try again.");
          setTimeout(() => setErrorMessage(null), 3000);
        }
      };

      // Fire listening indicator event
      window.dispatchEvent(new CustomEvent("voice-recording-start"));

      mediaRecorder.start();
      setRecordingState("recording");
    } catch (err) {
      console.error("[MicButton] Failed to start recording:", err);
      setRecordingState("error");
      setErrorMessage("Microphone access denied. Please allow microphone permissions.");
      setTimeout(() => setErrorMessage(null), 5000);
    }
  }, [aui]);

  const handleStopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      window.dispatchEvent(new CustomEvent("voice-recording-end"));
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleToggle = useCallback(() => {
    if (recordingState === "recording") {
      handleStopRecording();
    } else {
      handleStartRecording();
    }
  }, [recordingState, handleStartRecording, handleStopRecording]);

  const isRecording = recordingState === "recording";
  const isLoading = recordingState === "processing";

  return (
    <div className="relative flex items-center">
      <TooltipIconButton
        tooltip={isRecording ? "Stop recording" : "Start voice input"}
        side="bottom"
        type="button"
        variant={isRecording ? "default" : "ghost"}
        size="icon"
        className={`size-8 rounded-full transition-all ${
          isRecording
            ? "bg-red-500 text-white hover:bg-red-600 animate-pulse"
            : "text-muted-foreground hover:text-foreground"
        }`}
        disabled={isLoading}
        aria-label={isRecording ? "Stop recording" : "Start voice input"}
        onClick={handleToggle}
      >
        {isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isRecording ? (
          <MicOff className="size-4" />
        ) : (
          <Mic className="size-4" />
        )}
      </TooltipIconButton>
      {errorMessage && (
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-destructive/10 px-2 py-0.5 text-destructive text-xs">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
