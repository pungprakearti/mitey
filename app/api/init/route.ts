import { NextResponse } from "next/server";
import { scanProject } from "@/lib/mitey/scanner";
import { TARGET_DIR } from "@/lib/mitey/config";

export async function GET() {
  try {
    console.log(`[MITEY] Full system re-index triggered for: ${TARGET_DIR}`);

    const files = await scanProject();
    const fileList = Array.isArray(files) ? files : [];

    return NextResponse.json({
      success: true,
      directory: TARGET_DIR,
      fileCount: fileList.length,
      files: fileList,
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
