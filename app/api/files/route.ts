import { NextResponse } from "next/server";
import { scanProject } from "@/lib/mitey/scanner";

export async function GET() {
  try {
    // We call scanProject to get the list of relative paths
    const files = await scanProject();
    return NextResponse.json({ files });
  } catch (error) {
    console.error("Error fetching files:", error);
    return NextResponse.json(
      { error: "Failed to fetch files" },
      { status: 500 },
    );
  }
}
