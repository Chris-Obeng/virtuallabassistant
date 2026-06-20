import { NextResponse } from "next/server";

// ─────────────────────────────────────────────
// POST /api/voice/tts
// Synthesize text to speech via Deepgram Aura-2
// Returns WebM audio bytes for browser playback
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

    let body: { text?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const { text } = body;
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing or empty 'text' field" },
        { status: 400 },
      );
    }

    // Trim to a reasonable length to avoid excessive TTS time
    const trimmed = text.trim().slice(0, 2000);

    // Build Deepgram TTS URL with Aura-2
    const url = new URL("https://api.deepgram.com/v1/speak");
    url.searchParams.set("model", "aura-2");
    url.searchParams.set("encoding", "linear16");
    url.searchParams.set("container", "wav");

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: trimmed }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      console.error("[TTS] Deepgram API error:", response.status, errorBody);
      return NextResponse.json(
        { error: `Speech synthesis failed: ${response.statusText}` },
        { status: response.status },
      );
    }

    // Return audio bytes directly
    const audioBuffer = await response.arrayBuffer();

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": audioBuffer.byteLength.toString(),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[TTS] Error synthesizing speech:", error);
    return NextResponse.json(
      { error: "Internal server error during speech synthesis" },
      { status: 500 },
    );
  }
}
