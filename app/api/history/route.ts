import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { TARGET_DIR } from "@/lib/mitey/config";

const INDEX_DIR = path.join(TARGET_DIR, ".mitey_index");
const CHAT_FILE = path.join(INDEX_DIR, "chat.json");
const SNIPPETS_FILE = path.join(INDEX_DIR, "snippets.json");

// Ensure the index directory exists before every read/write
async function ensureDir() {
  await fs.mkdir(INDEX_DIR, { recursive: true });
}

// GET /api/history?type=chat|snippets
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type");
  if (type !== "chat" && type !== "snippets") {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  try {
    await ensureDir();
    const filePath = type === "chat" ? CHAT_FILE : SNIPPETS_FILE;
    const raw = await fs.readFile(filePath, "utf-8").catch(() => null);
    const data = raw ? JSON.parse(raw) : [];
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[MITEY] History read error:", e);
    return NextResponse.json({ data: [] });
  }
}

// POST /api/history  body: { type: "chat"|"snippets", data: any[] }
export async function POST(req: NextRequest) {
  try {
    const { type, data } = await req.json();
    if (type !== "chat" && type !== "snippets") {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    await ensureDir();
    const filePath = type === "chat" ? CHAT_FILE : SNIPPETS_FILE;
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[MITEY] History write error:", e);
    return NextResponse.json({ error: "Write failed" }, { status: 500 });
  }
}

// DELETE /api/history — wipes both chat and snippets for this directory
export async function DELETE() {
  try {
    await ensureDir();
    await Promise.all([
      fs.writeFile(CHAT_FILE, "[]", "utf-8"),
      fs.writeFile(SNIPPETS_FILE, "[]", "utf-8"),
    ]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[MITEY] History delete error:", e);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
