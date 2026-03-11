import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import {
  TARGET_DIR,
  OLLAMA_CONFIG,
  miteyConfig,
  getModelSettings,
} from "@/lib/mitey/config";
import fs from "fs/promises";
import path from "path";
import { OllamaEmbeddings } from "@langchain/ollama";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { getFiles, hybridSearch } from "@/lib/mitey/scanner";

const ollama = createOpenAI({
  baseURL: OLLAMA_CONFIG.V1,
  apiKey: "ollama",
});

const embeddings = new OllamaEmbeddings({
  model: OLLAMA_CONFIG.EMBED_MODEL,
  baseUrl: OLLAMA_CONFIG.HOST,
});

// --- Module-level caches ---
// These live for the lifetime of the Next.js server process, meaning they
// are initialized once on the first request and reused for every subsequent
// one. This avoids reading the vector index off disk on every chat message.

let cachedVectorStore: HNSWLib | null = null;
let cachedFileManifest: string | null = null;

/**
 * Returns the HNSWLib vector store, loading it from disk only on the
 * first call. Subsequent calls return the in-memory instance immediately.
 * Call invalidateCache() after a re-index to force a fresh load.
 */
async function getVectorStore(): Promise<HNSWLib> {
  if (!cachedVectorStore) {
    console.log("[MITEY] Loading vector store into memory cache...");
    cachedVectorStore = await HNSWLib.load(miteyConfig.dbPath, embeddings);
    console.log("[MITEY] ✅ Vector store cached.");
  }
  return cachedVectorStore;
}

/**
 * Returns the file manifest string, scanning the project only on the
 * first call. Capped at 80 files to keep token usage reasonable.
 */
async function getFileManifest(): Promise<string> {
  if (!cachedFileManifest) {
    console.log("[MITEY] Building file manifest cache...");
    const allFilePaths = await getFiles(TARGET_DIR, SUPPORTED_EXTENSIONS);
    const relPaths = allFilePaths
      .map((p) => path.relative(TARGET_DIR, p))
      .sort();
    cachedFileManifest = relPaths.slice(0, 80).join("\n");
    console.log("[MITEY] ✅ File manifest cached.");
  }
  return cachedFileManifest;
}

/**
 * Call this after a re-index (e.g. updateFileIndex) so the next request
 * picks up the freshly built vector store and updated file list.
 */
export function invalidateCache() {
  cachedVectorStore = null;
  cachedFileManifest = null;
  console.log("[MITEY] 🔄 Vector store and manifest cache invalidated.");
}

async function findFileInProject(
  targetName: string,
): Promise<{ content: string; relPath: string } | null> {
  const searchDir = async (
    dir: string,
  ): Promise<{ content: string; relPath: string } | null> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith("."))
          continue;
        const found = await searchDir(fullPath);
        if (found) return found;
      } else if (fullPath.endsWith(targetName) || entry.name === targetName) {
        const content = await fs.readFile(fullPath, "utf-8");
        return { content, relPath: path.relative(TARGET_DIR, fullPath) };
      }
    }
    return null;
  };
  return searchDir(TARGET_DIR);
}

const SUPPORTED_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".json", ".md"];

export async function POST(req: Request) {
  try {
    const { messages, activeFile, highlightedCode, selectedModel } =
      await req.json();

    const currentModel = selectedModel || OLLAMA_CONFIG.CHAT_MODEL;
    console.log(`[MITEY] API received request for model: ${currentModel}`);

    const settings = getModelSettings(currentModel);

    const history = messages.slice(-10, -1).map((m: any) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));

    const lastUserQuery = messages[messages.length - 1]?.content || "";

    let fileContext = "";
    let retrievedContext = "";
    let foundPath = activeFile || "";
    let ragSources: string[] = [];

    // 1. File manifest — cached after first request, no repeated disk traversal
    let fileManifest = "";
    try {
      fileManifest = await getFileManifest();
    } catch (e) {
      console.log("[MITEY] Could not build file manifest.");
    }

    // 2. File Lookup
    const fileMatch = lastUserQuery.match(
      /([a-zA-Z0-9_\-\/]+\.(ts|tsx|js|jsx|json|md))/i,
    );
    if (fileMatch && !activeFile) {
      const discovery = await findFileInProject(fileMatch[1]);
      if (discovery) {
        fileContext = discovery.content;
        foundPath = discovery.relPath;
      }
    } else if (activeFile) {
      const fullPath = path.join(TARGET_DIR, activeFile);
      const content = await fs.readFile(fullPath, "utf-8").catch(() => null);
      fileContext = content ? content.slice(0, 12000) : "";
    }

    // 3. Hybrid Search — vector store loaded from cache, not disk
    try {
      const vectorStore = await getVectorStore();
      const searchResults = await hybridSearch(lastUserQuery, vectorStore, 8);

      ragSources = [
        ...new Set(searchResults.map((doc) => doc.metadata.source as string)),
      ];
      retrievedContext = searchResults
        .map((doc) => `[CONTEXT: ${doc.metadata.source}]\n${doc.pageContent}`)
        .join("\n\n---\n\n");

      console.log(
        `[MITEY] Hybrid search returned ${searchResults.length} chunks from: ${ragSources.join(", ")}`,
      );
    } catch (e) {
      console.log("[MITEY] Search skip:", e);
    }

    // 4. System Prompt — CRITICAL RULE first for best instruction-following
    const systemPrompt = `## CRITICAL RULE — READ THIS FIRST
You MUST only reference code, file paths, function names, and imports that appear verbatim in the context provided to you. The project file manifest below lists every file that exists. If a file is not in that list, it does not exist — do NOT invent it.
If the provided context does not contain enough information to answer accurately, say exactly: "I don't have enough context in the index to answer this accurately." Do NOT generate plausible-looking but invented code, imports, or file paths.

---

You are Mitey, a senior staff engineer and code assistant embedded directly in the user's codebase. You have deep context about the project through semantic search and direct file access.

## Your Personality
- Direct, precise, and confident — never hedge unnecessarily
- You think before you answer (use [THOUGHT]...[/THOUGHT] to reason through problems)
- You prefer showing over telling: concrete code changes beat vague advice
- You acknowledge uncertainty honestly rather than guessing

## How to Respond
1. Open with [THOUGHT] — briefly reason about what's actually being asked and what the right approach is
2. Close reasoning with [/THOUGHT]
3. Give your answer directly — no preamble like "Sure!" or "Great question!"
4. For code changes: show the exact diff or replacement block, not the whole file unless asked
5. For questions: be concise. One clear answer, then stop.
6. If the codebase context doesn't contain what you need, say so explicitly

## Rules
- All code in triple backtick blocks with the correct language tag
- Never invent file paths, function names, or variable names not present in the provided context
- Never repeat the user's question back to them
- If a question is ambiguous, ask ONE clarifying question — don't guess
- Prefer the patterns and conventions already present in the codebase
- Do not add unnecessary comments explaining obvious code
- When tracing code flow, name the specific functions and variables involved, not just the files`;

    const userContentWithContext = `
### PROJECT FILES — THE ONLY FILES THAT EXIST IN THIS CODEBASE
\`\`\`
${fileManifest || "File manifest unavailable."}
\`\`\`

${fileContext ? `### ACTIVE FILE: ${foundPath}\n\`\`\`\n${highlightedCode || fileContext}\n\`\`\`` : "No specific file is currently selected."}

### BACKGROUND KNOWLEDGE (RAG — hybrid vector + keyword search)
${retrievedContext || "No additional context retrieved."}

### CURRENT REQUEST
${lastUserQuery}`;

    const result = await streamText({
      model: ollama(currentModel),
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userContentWithContext },
      ],
      ...settings,
    });

    console.log(`\n--- MITEY [${currentModel}] STREAM START ---`);

    const logStream = new TransformStream({
      transform(chunk, controller) {
        process.stdout.write(chunk);
        controller.enqueue(chunk);
      },
      flush() {
        console.log(`\n--- MITEY [${currentModel}] STREAM END ---\n`);
      },
    });

    const responseStream = result.textStream.pipeThrough(logStream);

    const headers: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    };

    if (ragSources.length > 0) {
      headers["X-Mitey-Sources"] = JSON.stringify(ragSources);
    }

    return new Response(responseStream, { headers });
  } catch (error) {
    console.error("MITEY_ERROR:", error);
    return new Response("Mitey Error", { status: 500 });
  }
}
