import { NextResponse } from "next/server";
import { OLLAMA_CONFIG } from "@/lib/mitey/config";
import { getGroqModelList } from "@/lib/mitey/groqModels";

export async function GET() {
  // ── Local Ollama models ───────────────────────────────────────────────────
  let localModels: string[] = [];
  try {
    const res = await fetch(`${OLLAMA_CONFIG.HOST}/api/tags`);
    if (res.ok) {
      const data = await res.json();
      localModels = (data.models ?? [])
        .filter((m: any) => m.name !== OLLAMA_CONFIG.EMBED_MODEL)
        .map((m: any) => m.name as string);
    }
  } catch {
    console.warn("[MITEY] Could not reach Ollama for model list.");
  }

  // ── Groq cloud models — uses shared cache ─────────────────────────────────
  const cloudModels = await getGroqModelList();

  return NextResponse.json({ localModels, cloudModels });
}
