import { NextResponse } from "next/server";

// ─────────────────────────────────────────────
// POST /api/voice/stt
// Transcribe audio bytes via Deepgram REST API (raw fetch)
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

    // Read raw audio bytes from the request body
    const audioBuffer = await request.arrayBuffer();
    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return NextResponse.json({ error: "No audio data received" }, { status: 400 });
    }

    // Log the first 16 bytes (EBML magic = 1a 45 df a3 for WebM)
    const header = Buffer.from(audioBuffer.slice(0, 16)).toString("hex");
    console.log(`[STT] Received ${audioBuffer.byteLength} bytes, header: ${header}`);

    // Build Deepgram URL
    const url = new URL("https://api.deepgram.com/v1/listen");
    url.searchParams.set("model", "nova-3");
    url.searchParams.set("language", "en");
    url.searchParams.set("punctuate", "true");
    url.searchParams.set("smart_format", "true");
    // No encoding param — Content-Type: audio/webm tells Deepgram the format

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
      console.error("[STT] Deepgram API error:", response.status, errorBody);
      return NextResponse.json(
        { error: `Deepgram transcription failed: ${response.status} ${errorBody}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    console.log(`[STT] Deepgram response status: ${data.metadata?.request_id ? "OK" : "unexpected"}`);
    console.log(`[STT] Deepgram channels: ${data?.results?.channels?.length ?? 0}`);

    // Print the first alternative if available for debugging
    const alt = data?.results?.channels?.[0]?.alternatives?.[0];
    if (alt) {
      console.log(`[STT] Transcript candidate: "${alt.transcript}" (confidence: ${alt.confidence})`);
    }

    const transcript: string = alt?.transcript ?? "";

    if (!transcript || transcript.trim().length === 0) {
      console.log("[STT] No speech detected. Full response keys:", Object.keys(data));
      if (data.results) {
        console.log("[STT] Results keys:", Object.keys(data.results));
        console.log("[STT] Channels count:", data.results.channels?.length);
      } else {
        console.log("[STT] No 'results' in response at all. Full response:", JSON.stringify(data).slice(0, 1000));
      }
      return NextResponse.json({
        transcript: "",
        warning: "No speech detected. Please try speaking again.",
      });
    }

    console.log(`[STT] Success: "${transcript.trim()}"`);
    return NextResponse.json({ transcript: transcript.trim() });
  } catch (error) {
    console.error("[STT] Error processing audio:", error);
    return NextResponse.json(
      { error: "Internal server error processing audio" },
      { status: 500 },
    );
  }
}
