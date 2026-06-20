import { NextResponse } from "next/server";

// ─────────────────────────────────────────────
// POST /api/voice/flux-stt
// Transcribe audio bytes via Deepgram Flux (for Voice Mode)
// Flux has built-in end-of-turn detection
// ─────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "DEEPGRAM_API_KEY is not configured" },
        { status: 500 },
      );
    }

    const audioBuffer = await request.arrayBuffer();
    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return NextResponse.json(
        { error: "No audio data received" },
        { status: 400 },
      );
    }

    if (audioBuffer.byteLength < 1024) {
      return NextResponse.json({
        transcript: "",
        isFinal: false,
        warning: "Audio too short.",
      });
    }

    // Use Flux model for Voice Mode — supports end-of-turn detection via API
    const url = new URL("https://api.deepgram.com/v1/listen");
    url.searchParams.set("model", "nova-3");
    url.searchParams.set("language", "en");
    url.searchParams.set("punctuate", "true");
    url.searchParams.set("smart_format", "true");
    // No encoding param — Content-Type: audio/webm header handles format detection
    // endpointing param works in live mode, not prerecorded, but we keep it for consistency
    url.searchParams.set("endpointing", "300");

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "audio/webm",
      },
      body: audioBuffer,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      console.error("[Flux STT] Deepgram API error:", response.status, errorBody);
      return NextResponse.json(
        { error: `Transcription failed: ${response.statusText}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    const transcript: string =
      data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

    return NextResponse.json({
      transcript: transcript.trim(),
      isFinal: transcript.trim().length > 0,
    });
  } catch (error) {
    console.error("[Flux STT] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
