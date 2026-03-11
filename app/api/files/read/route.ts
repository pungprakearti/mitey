import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { TARGET_DIR } from "@/lib/mitey/config";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filePath = searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "No path provided" }, { status: 400 });
  }

  try {
    // FIX: Use TARGET_DIR so this works correctly when launched via `npx mitey`
    // process.cwd() points to the Mitey app directory, not the user's project
    const fullPath = path.join(TARGET_DIR, filePath);

    const stats = await fs.stat(fullPath);

    // 100KB is a safe limit for browser syntax highlighters.
    // package-lock.json is usually 1MB+, which causes freezes.
    const MAX_VIEW_SIZE = 100 * 1024;

    if (stats.size > MAX_VIEW_SIZE) {
      return NextResponse.json(
        {
          error: "FILE_TOO_LARGE",
          message: `This file is ${Math.round(stats.size / 1024)}KB. Rendering it would freeze your browser session.`,
          size: stats.size,
        },
        { status: 200 },
      );
    }

    const content = await fs.readFile(fullPath, "utf8");
    return NextResponse.json({ content });
  } catch (error) {
    console.error("Read Error:", error);
    return NextResponse.json({ error: "Could not read file" }, { status: 500 });
  }
}
