import { NextResponse } from "next/server";
import { OLLAMA_CONFIG } from "@/lib/mitey/config";

export async function GET() {
  try {
    const response = await fetch(`${OLLAMA_CONFIG.HOST}/api/tags`);
    if (!response.ok) throw new Error("Failed to fetch from Ollama");

    const data = await response.json();

    // Filter out the embedding model and map to simple names
    const chatModels = data.models
      .filter((m: any) => m.name !== OLLAMA_CONFIG.EMBED_MODEL)
      .map((m: any) => m.name);

    return NextResponse.json({ models: chatModels });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
