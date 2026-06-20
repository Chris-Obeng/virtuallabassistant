import {
  createVoiceSession,
  type RealtimeVoiceAdapter,
} from "@assistant-ui/react";

/**
 * Deepgram Voice Adapter for assistant-ui RealtimeVoiceAdapter.
 *
 * Captures raw PCM audio from the microphone via AudioContext and
 * sends it to a local WebSocket proxy (ws-server.ts) which relays it
 * to Deepgram's real-time STT API.
 *
 * Uses linear16 encoding (raw PCM) which Deepgram's WebSocket API
 * supports natively — no WebM container issues.
 */
/**
 * Build the WebSocket URL for the Deepgram proxy.
 *
 * Priority:
 * 1. options.wsUrl (explicit override)
 * 2. window.__VOICE_WS_URL (runtime global, set via <script> tag)
 * 3. NEXT_PUBLIC_VOICE_WS_URL (build-time env var, inlined by Next.js)
 * 4. Auto-detection: if served over HTTPS, derive wss://hostname:3001/ws
 * 5. Fallback: ws://localhost:3001/ws (local dev)
 */
function resolveWsUrl(options?: { wsUrl?: string }): string {
  // 1. Explicit override
  if (options?.wsUrl) return options.wsUrl;

  // 2. Runtime global (settable without rebuild)
  if (typeof window !== "undefined" && (window as any).__VOICE_WS_URL) {
    return (window as any).__VOICE_WS_URL;
  }

  // 3. NEXT_PUBLIC_ build-time env var
  const publicEnvVar =
    typeof process !== "undefined" &&
    typeof process.env !== "undefined" &&
    process.env.NEXT_PUBLIC_VOICE_WS_URL;
  if (publicEnvVar) return publicEnvVar;

  // 4. Local dev fallback — will fail in production with a clear connection error.
  //     On Railway, the WebSocket proxy is a separate service at a different URL.
  //     Set NEXT_PUBLIC_VOICE_WS_URL in Railway env vars to make it work.
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:"
  ) {
    console.warn(
      "[DeepgramVoiceAdapter] Running on HTTPS but no NEXT_PUBLIC_VOICE_WS_URL set.",
      "Voice Mode will not work. Set NEXT_PUBLIC_VOICE_WS_URL in Railway env vars.",
    );
  }

  return "ws://localhost:3001/ws";
}

export class DeepgramVoiceAdapter implements RealtimeVoiceAdapter {
  private wsUrl: string;

  constructor(options: { wsUrl?: string } = {}) {
    this.wsUrl = resolveWsUrl(options);
    console.log("[DeepgramVoiceAdapter] Connecting to WebSocket URL:", this.wsUrl);
  }

  connect(
    options: { abortSignal?: AbortSignal },
  ): RealtimeVoiceAdapter.Session {
    return createVoiceSession(options, async (helpers) => {
      const ws = new WebSocket(this.wsUrl);

      let audioContext: AudioContext | null = null;
      let mediaStream: MediaStream | null = null;
      let source: MediaStreamAudioSourceNode | null = null;
      let processor: ScriptProcessorNode | null = null;
      let volumeInterval: ReturnType<typeof setInterval> | null = null;

      ws.onopen = () => {
        helpers.setStatus({ type: "running" });
        helpers.emitMode("listening");

        // Get mic stream and set up raw PCM capture
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            mediaStream = stream;
            audioContext = new AudioContext({ sampleRate: 16000 }); // 16kHz for Deepgram
            source = audioContext.createMediaStreamSource(stream);

            // Set up volume analysis
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            volumeInterval = setInterval(() => {
              analyser.getByteFrequencyData(dataArray);
              const avg = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
              helpers.emitVolume(avg / 255);
            }, 100);

            // Use ScriptProcessorNode to capture raw PCM samples
            // Buffer size: 4096 samples, ~256ms at 16kHz
            processor = audioContext.createScriptProcessor(4096, 1, 1);

            processor.onaudioprocess = (event) => {
              if (helpers.isDisposed()) return;
              if (ws.readyState !== WebSocket.OPEN) return;

              const input = event.inputBuffer.getChannelData(0);
              // Convert Float32 (-1 to 1) to Int16 (linear16) for Deepgram
              const pcmBuffer = float32ToInt16(input);
              ws.send(pcmBuffer);
            };

            source.connect(processor);
            processor.connect(audioContext.destination);
          })
          .catch((err) => {
            console.error("[DeepgramVoiceAdapter] Mic access denied:", err);
            helpers.end("error", err);
          });
      };

      // Handle incoming messages from the server (transcripts)
      ws.onmessage = (event) => {
        if (helpers.isDisposed()) return;

        try {
          const data = JSON.parse(event.data as string);

          if (data.type === "transcript" && data.text) {
            if (data.isFinal) {
              helpers.emitTranscript({
                role: "user",
                text: data.text,
                isFinal: true,
              });
              helpers.emitMode("speaking");
            }
          } else if (data.type === "mode") {
            helpers.emitMode(data.mode as "listening" | "speaking");
          } else if (data.type === "error") {
            console.error("[DeepgramVoiceAdapter] Server error:", data.message);
          }
        } catch {
          // Binary data, ignore
        }
      };

      ws.onerror = (event) => {
        const errorMsg =
          (event as any)?.message ||
          (event as any)?.reason ||
          "Could not connect to Voice Mode WebSocket server at " +
            this.wsUrl +
            ". Make sure the WebSocket proxy server is running: npx tsx ws-server.ts";
        console.error("[DeepgramVoiceAdapter] WebSocket error:", errorMsg);
        if (!helpers.isDisposed()) {
          helpers.end("error", new Error(errorMsg));
        }
      };

      ws.onclose = () => {
        if (!helpers.isDisposed()) {
          helpers.end("finished");
        }
      };

      return {
        disconnect: () => {
          if (processor && audioContext && source) {
            source.disconnect(processor);
            processor.disconnect(audioContext.destination);
          }
          if (volumeInterval) clearInterval(volumeInterval);
          if (audioContext) audioContext.close();
          if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
          if (ws.readyState === WebSocket.OPEN) ws.close();
        },
        mute: () => {
          if (audioContext) audioContext.suspend();
        },
        unmute: () => {
          if (audioContext) audioContext.resume();
        },
      };
    });
  }
}

/**
 * Converts Float32 audio buffer (values -1 to 1) to Int16 linear16 PCM
 * as expected by Deepgram's WebSocket API.
 */
function float32ToInt16(float32: Float32Array): ArrayBuffer {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16.buffer;
}
