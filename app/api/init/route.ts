import { NextResponse } from "next/server";
import { scanProject } from "@/lib/mitey/scanner";
import { TARGET_DIR } from "@/lib/mitey/config";

export async function GET() {
  try {
    console.log(`[MITEY] Automatic scan triggered for: ${TARGET_DIR}`);

    // This runs your existing scanner logic
    const files = await scanProject();

    // Safety check: ensure files is an array
    const fileList = Array.isArray(files) ? files : [];

    return NextResponse.json({
      success: true,
      directory: TARGET_DIR,
      fileCount: fileList.length,
      files: fileList, // Your Sidebar can use this initial data
    });
  } catch (error: any) {
    console.error("[INIT ERROR]:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Unknown error during initialization",
      },
      { status: 500 },
    );
  }
}
