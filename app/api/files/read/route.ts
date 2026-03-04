import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filePath = searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "No path provided" }, { status: 400 });
  }

  try {
    const fullPath = path.join(process.cwd(), filePath);

    // 1. Get file stats first to check the size
    const stats = await fs.stat(fullPath);

    // 100KB is a safe limit for browser syntax highlighters.
    // package-lock.json is usually 1MB+, which causes the freeze.
    const MAX_VIEW_SIZE = 100 * 1024;

    if (stats.size > MAX_VIEW_SIZE) {
      return NextResponse.json(
        {
          error: "FILE_TOO_LARGE",
          message: `This file is ${Math.round(stats.size / 1024)}KB. Rendering it would freeze your browser session.`,
          size: stats.size,
        },
        { status: 200 },
      ); // We return 200 so the frontend can read the JSON error safely
    }

    // 2. Only read if the file is within the safe limit
    const content = await fs.readFile(fullPath, "utf8");

    return NextResponse.json({ content });
  } catch (error) {
    console.error("Read Error:", error);
    return NextResponse.json({ error: "Could not read file" }, { status: 500 });
  }
}
