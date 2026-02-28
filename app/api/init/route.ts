import { NextResponse } from "next/server";
import { scanProject } from "@/lib/mitey/scanner";
import { TARGET_DIR } from "@/lib/mitey/config";

export async function GET() {
  try {
    console.log(`[MITEY] Automatic scan triggered for: ${TARGET_DIR}`);

    // This runs your existing scanner logic
    const files = await scanProject();

    return NextResponse.json({
      success: true,
      directory: TARGET_DIR,
      fileCount: files.length,
      files: files,
    });
  } catch (error: any) {
    console.error("[INIT ERROR]:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
