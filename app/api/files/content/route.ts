import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const relativePath = searchParams.get("path");

  if (!relativePath) {
    return NextResponse.json(
      { error: "No file path provided" },
      { status: 400 },
    );
  }

  try {
    const fullPath = path.resolve(process.cwd(), relativePath);
    const stats = await fs.stat(fullPath);

    // 100KB is the safety limit for the browser's syntax highlighter
    const MAX_VIEW_SIZE = 100 * 1024;

    if (stats.size > MAX_VIEW_SIZE) {
      return NextResponse.json(
        {
          error: "FILE_TOO_LARGE",
          message: `This file is ${Math.round(stats.size / 1024)}KB. Rendering it would freeze your browser.`,
          size: stats.size,
        },
        { status: 200 },
      ); // Status 200 so the frontend can catch the custom error code
    }

    const content = await fs.readFile(fullPath, "utf-8");
    return NextResponse.json({ content });
  } catch (error) {
    console.error("[CONTENT ERROR]:", error);
    return NextResponse.json({ error: "Could not read file" }, { status: 500 });
  }
}
