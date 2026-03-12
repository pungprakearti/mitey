import { NextResponse } from "next/server";
import { CLOUD_CONFIG } from "@/lib/mitey/config";

// GET /api/cloud-status
// Returns whether the Groq API key is configured server-side.
// The key itself never leaves the server — we only return a boolean.
export async function GET() {
  return NextResponse.json({
    configured: CLOUD_CONFIG.isConfigured,
    model: CLOUD_CONFIG.isConfigured ? CLOUD_CONFIG.CODE_EDIT_MODEL : null,
    provider: "Groq",
  });
}
