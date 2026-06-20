/**
 * WebSocket Proxy Server for Deepgram Voice Mode (STT).
 *
 * Runs on port 3001 alongside the Next.js dev server.
 * Relays: Browser audio chunks → Deepgram WebSocket → Transcripts back to browser.
 *
 * Uses Deepgram Nova-3 with endpointing for end-of-turn detection.
 *
 * Start with: npx tsx ws-server.ts
 */

import { WebSocketServer, WebSocket as Ws } from "ws";
import { createServer } from "http";

// Load environment variables (standalone script, not Next.js — no automatic .env loading)
import dotenv from "dotenv";
dotenv.config();                        // reads .env
dotenv.config({ path: ".env.local", override: true });  // .env.local takes precedence

// Railway assigns PORT automatically. Fall back to VOICE_WS_PORT for local dev.
const PORT = parseInt(process.env.PORT || process.env.VOICE_WS_PORT || "3001", 10);
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

if (!DEEPGRAM_API_KEY) {
  console.error(
    "[Voice WS] DEEPGRAM_API_KEY is not set. Voice Mode will not work.",
  );
  process.exit(1);
}

const server = createServer();

const wss = new WebSocketServer({ server });

wss.on("connection", (clientWs: Ws) => {
  console.log("[Voice WS] Browser client connected");

  // Connect to Deepgram real-time STT API
  const dgUrl = new URL("wss://api.deepgram.com/v1/listen");
  dgUrl.searchParams.set("model", "nova-3");
  dgUrl.searchParams.set("language", "en");
  dgUrl.searchParams.set("punctuate", "true");
  dgUrl.searchParams.set("smart_format", "true");
  // The adapter sends raw PCM linear16 audio at 16kHz
  dgUrl.searchParams.set("encoding", "linear16");
  dgUrl.searchParams.set("sample_rate", "16000");
  // endpointing: 300ms of silence = end of turn
  dgUrl.searchParams.set("endpointing", "300");
  dgUrl.searchParams.set("interim_results", "true");
  dgUrl.searchParams.set("utterance_end_ms", "1000");

  console.log("[Voice WS] Connecting to Deepgram...");

  const dgWs = new Ws(dgUrl.toString(), {
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`,
    },
  });

  let isDgOpen = false;

  dgWs.on("open", () => {
    console.log("[Voice WS] Connected to Deepgram");
    isDgOpen = true;

    clientWs.send(
      JSON.stringify({ type: "mode", mode: "listening" }),
    );
  });

  dgWs.on("message", (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "Results") {
        const channel = msg.channel;
        const alternative = channel?.alternatives?.[0];
        const transcript = alternative?.transcript ?? "";

        if (msg.is_final && transcript) {
          // End-of-turn detected
          console.log("[Voice WS] Final transcript:", transcript);

          clientWs.send(
            JSON.stringify({
              type: "transcript",
              text: transcript,
              isFinal: true,
            }),
          );
        } else if (transcript) {
          // Interim result
          clientWs.send(
            JSON.stringify({
              type: "transcript",
              text: transcript,
              isFinal: false,
            }),
          );
        }
      }
    } catch {
      // Binary/unparseable data, ignore
    }
  });

  dgWs.on("error", (err: Error) => {
    console.error("[Voice WS] Deepgram error:", err.message);
    try {
      clientWs.send(
        JSON.stringify({ type: "error", message: err.message }),
      );
    } catch { /* client may already be disconnected */ }
  });

  dgWs.on("close", () => {
    console.log("[Voice WS] Deepgram disconnected");
    isDgOpen = false;
    try { clientWs.close(); } catch { /* ignore */ }
  });

  // Relay audio chunks from browser to Deepgram
  clientWs.on("message", (data: Buffer) => {
    if (isDgOpen && dgWs.readyState === Ws.OPEN) {
      dgWs.send(data);
    }
  });

  clientWs.on("close", () => {
    console.log("[Voice WS] Browser client disconnected");
    if (dgWs.readyState === Ws.OPEN) {
      dgWs.close();
    }
  });

  clientWs.on("error", (err: Error) => {
    console.error("[Voice WS] Client error:", err.message);
    if (dgWs.readyState === Ws.OPEN) {
      dgWs.close();
    }
  });
});

server.listen(PORT, () => {
  console.log(`[Voice WS] Server running on ws://localhost:${PORT}/ws`);
  console.log(`[Voice WS] Ready for Voice Mode connections`);
});
