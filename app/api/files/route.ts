import { NextResponse } from "next/server";
import { scanProject, updateFileIndex } from "@/lib/mitey/scanner";

export async function GET() {
  try {
    console.log("[API] GET /api/files - Fetching file list");
    const files = await scanProject();
    return NextResponse.json({ files });
  } catch (error) {
    console.error("[API] Error fetching files:", error);
    return NextResponse.json(
      { error: "Failed to fetch files" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const { filePath } = await req.json();

    if (!filePath) {
      return NextResponse.json({ error: "No path provided" }, { status: 400 });
    }

    console.log(`[API] POST /api/files - Requesting reindex for: ${filePath}`);
    await updateFileIndex(filePath);

    return NextResponse.json({ success: true, updated: filePath });
  } catch (error) {
    console.error("[API] Error updating file index:", error);
    return NextResponse.json(
      { error: "Failed to update file index" },
      { status: 500 },
    );
  }
}
