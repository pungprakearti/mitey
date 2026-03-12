import { createOpenAI } from "@ai-sdk/openai";
import { createGroq } from "@ai-sdk/groq";
import { streamText } from "ai";
import {
  TARGET_DIR,
  OLLAMA_CONFIG,
  CLOUD_CONFIG,
  miteyConfig,
  getModelSettings,
} from "@/lib/mitey/config";
import fs from "fs/promises";
import path from "path";
import { OllamaEmbeddings } from "@langchain/ollama";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { getIndexableFiles, hybridSearch } from "@/lib/mitey/scanner";
import { isGroqModel } from "@/lib/mitey/groqModels";

// ─── Provider clients ─────────────────────────────────────────────────────────

const ollama = createOpenAI({
  baseURL: OLLAMA_CONFIG.V1,
  apiKey: "ollama",
});

const groq = createGroq({
  apiKey: CLOUD_CONFIG.API_KEY || "no-key",
});

const embeddings = new OllamaEmbeddings({
  model: OLLAMA_CONFIG.EMBED_MODEL,
  baseUrl: OLLAMA_CONFIG.HOST,
});

// ─── Module-level caches ──────────────────────────────────────────────────────

let cachedVectorStore: HNSWLib | null = null;
let cachedFileManifest: string | null = null;

async function getVectorStore(): Promise<HNSWLib> {
  if (!cachedVectorStore) {
    console.log("[MITEY] Loading vector store into memory cache...");
    cachedVectorStore = await HNSWLib.load(miteyConfig.dbPath, embeddings);
    console.log("[MITEY] ✅ Vector store cached.");
  }
  return cachedVectorStore;
}

async function getFileManifest(): Promise<string> {
  if (!cachedFileManifest) {
    console.log("[MITEY] Building file manifest cache...");
    const allFilePaths = await getIndexableFiles(TARGET_DIR);
    const relPaths = allFilePaths
      .map((p) => path.relative(TARGET_DIR, p))
      .sort();
    cachedFileManifest = relPaths.slice(0, 80).join("\n");
    console.log("[MITEY] ✅ File manifest cached.");
  }
  return cachedFileManifest;
}

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

const CODE_EDIT_PATTERN =
  /\b(fix|change|update|refactor|rename|add|remove|replace|modify|rewrite|delete|move|extract|split|merge|convert|implement|create)\b/i;

// ─── Structured error response ────────────────────────────────────────────────
// Returns a JSON error body the client can parse and display in the chat window.
// Using 200 so the client's response.ok check passes and it can read the body —
// the `X-Mitey-Error` header signals that this is an error message, not a stream.

function errorResponse(code: string, message: string): Response {
  console.error(`[MITEY] ❌ ${code}: ${message}`);
  return new Response(JSON.stringify({ code, message }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Mitey-Error": "1",
    },
  });
}

// Map AI SDK / fetch errors to friendly messages the user can act on.
function classifyError(
  error: any,
  modelId: string,
  provider: "groq" | "ollama",
): { code: string; message: string } {
  const status = error?.status ?? error?.statusCode;
  const body = error?.responseBody ?? error?.message ?? "";

  if (provider === "ollama") {
    if (status === 404 || body.includes("not found")) {
      return {
        code: "MODEL_NOT_FOUND",
        message: `Ollama couldn't find model "${modelId}". Run \`ollama pull ${modelId}\` in your terminal and try again.`,
      };
    }
    if (error?.code === "ECONNREFUSED" || body.includes("ECONNREFUSED")) {
      return {
        code: "OLLAMA_OFFLINE",
        message:
          "Ollama isn't running. Start it with \`ollama serve\` and try again.",
      };
    }
  }

  if (provider === "groq") {
    if (status === 401) {
      return {
        code: "GROQ_AUTH",
        message:
          "Groq API key is invalid or expired. Check GROQ_API_KEY in your .env.local.",
      };
    }
    if (status === 429) {
      return {
        code: "GROQ_RATE_LIMIT",
        message: `Groq rate limit hit for "${modelId}". Try again in a moment, or switch to a local model.`,
      };
    }
    if (status === 404 || body.includes("not found")) {
      return {
        code: "GROQ_MODEL_NOT_FOUND",
        message: `Groq doesn't recognise model "${modelId}". It may have been deprecated — pick another from the dropdown.`,
      };
    }
    if (status === 400 && body.includes("content")) {
      return {
        code: "GROQ_CONTENT_POLICY",
        message:
          "Groq refused this request due to its content policy. The local fallback model was used instead.",
      };
    }
  }

  return {
    code: "UNKNOWN_ERROR",
    message: `Something went wrong with ${provider} (${modelId})${status ? ` — status ${status}` : ""}. Check the server logs for details.`,
  };
}

// ─── Stream helper ────────────────────────────────────────────────────────────

function buildStreamResponse(
  textStream: AsyncIterable<string>,
  modelName: string,
  provider: "groq" | "ollama",
  ragSources: string[],
  usedFallback: boolean,
): Response {
  const logStream = new TransformStream({
    transform(chunk, controller) {
      process.stdout.write(chunk);
      controller.enqueue(chunk);
    },
    flush() {
      console.log(`\n--- MITEY [${modelName}] STREAM END ---\n`);
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "X-Mitey-Model": modelName,
    "X-Mitey-Provider": provider,
    "X-Mitey-Fallback": usedFallback ? "1" : "0",
  };

  if (ragSources.length > 0) {
    headers["X-Mitey-Sources"] = JSON.stringify(ragSources);
  }

  // @ts-ignore
  return new Response(textStream.pipeThrough(logStream), { headers });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const {
      messages,
      activeFile,
      highlightedCode,
      generalModel,
      codeEditModel,
    } = await req.json();

    const lastUserQuery = messages[messages.length - 1]?.content || "";

    // ── Determine which model and provider to use ─────────────────────────────
    const isCodeEdit = CODE_EDIT_PATTERN.test(lastUserQuery);
    const selectedModel = isCodeEdit
      ? codeEditModel || OLLAMA_CONFIG.CHAT_MODEL
      : generalModel || OLLAMA_CONFIG.CHAT_MODEL;

    // Check the live Groq model cache — reliable regardless of model ID format.
    // Falls back to false if Groq isn't configured or the cache is empty.
    const isCloudModel =
      CLOUD_CONFIG.isConfigured && (await isGroqModel(selectedModel));

    // Pre-flight fallback: key not configured at all
    const effectiveModel =
      isCloudModel && !CLOUD_CONFIG.isConfigured
        ? OLLAMA_CONFIG.CHAT_MODEL
        : selectedModel;

    if (isCloudModel && !CLOUD_CONFIG.isConfigured) {
      console.warn(
        "[MITEY] ⚠️  Groq model selected but GROQ_API_KEY is not set — falling back to local model.",
      );
    }

    // ── Log ───────────────────────────────────────────────────────────────────
    console.log(`\n${"═".repeat(60)}`);
    console.log(`[MITEY] 📝 Query: ${lastUserQuery}`);
    console.log(
      `[MITEY] 🤖 Agent: ${isCodeEdit ? "Code Agent" : "General Agent"} → ${effectiveModel}${isCloudModel ? " ☁️  (Groq)" : " 🖥️  (Ollama)"}`,
    );
    console.log(`${"═".repeat(60)}\n`);

    if (isCodeEdit) {
      console.log(`[MITEY] 🔧 Code edit detected — injecting full file.`);
    }

    const settings = getModelSettings(effectiveModel);

    const history = messages.slice(-10, -1).map((m: any) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));

    let fileContext = "";
    let retrievedContext = "";
    let foundPath = activeFile || "";
    let ragSources: string[] = [];

    // 1. File manifest
    let fileManifest = "";
    try {
      fileManifest = await getFileManifest();
    } catch (e) {
      console.log("[MITEY] Could not build file manifest.");
    }

    // 2. File lookup
    const fileMatch = lastUserQuery.match(
      /([a-zA-Z0-9_\-\/]+\.(?:tsx?|jsx?|json|md))/i,
    );
    if (fileMatch && !activeFile) {
      console.log(`[MITEY] 🔎 File lookup: searching for "${fileMatch[1]}"`);
      const discovery = await findFileInProject(fileMatch[1]);
      if (discovery) {
        fileContext = discovery.content;
        foundPath = discovery.relPath;
        console.log(`[MITEY] ✅ File found: ${foundPath}`);
      } else {
        console.log(`[MITEY] ⚠️  File not found: ${fileMatch[1]}`);
      }
    } else if (activeFile) {
      const fullPath = path.join(TARGET_DIR, activeFile);
      const content = await fs.readFile(fullPath, "utf-8").catch(() => null);
      if (content) {
        fileContext = isCodeEdit ? content : content.slice(0, 12000);
        console.log(
          `[MITEY] ✅ Active file loaded: ${activeFile} (${isCodeEdit ? "full" : "12k slice"})`,
        );
      }
    }

    // 3. Hybrid search
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
        `[MITEY] Hybrid search: ${searchResults.length} chunks from: ${ragSources.join(", ")}`,
      );
    } catch (e) {
      console.log("[MITEY] Search skip:", e);
    }

    // 4. System prompt
    const systemPrompt = `## CRITICAL RULES — READ THESE FIRST
1. Only reference code, file paths, function names, and imports that appear verbatim in the provided context. The file manifest is the ground truth — if a file isn't listed there, it does not exist. Never invent paths, imports, or function names.
2. Never output generic advice. Every observation, suggestion, or answer MUST cite a specific file, function, variable, or line from the context you were given. If you find yourself writing something that could apply to any codebase, stop and make it specific to THIS codebase instead.
3. "I don't have enough context" is only acceptable when asked for a specific fact (a function signature, a variable name, a line number) that is genuinely absent. It is NEVER acceptable as a response to analysis, optimization, architecture, or review questions — for those, reason deeply over the retrieved context and give concrete, grounded answers.

---

You are Mitey, a senior staff engineer embedded directly in the user's codebase. You have retrieved relevant code via semantic + keyword search and have direct file access.

## Your Personality
- Direct, precise, and confident — no hedging, no preamble
- You think before you answer using structured reasoning
- You prefer showing over telling: concrete code beats vague advice
- When you say something can be improved, you show exactly how

## How to Respond
ALWAYS use this exact two-part structure — no exceptions:

PART 1: Open with a reasoning block. The [THOUGHT] tag opens it, [/THOUGHT] closes it. Nothing but your reasoning goes inside.

[THOUGHT]
**Step 1 — Understand the request:**
<scope and intent>

**Step 2 — Locate the relevant code:**
<exact file names, function names, line content from the provided context>

**Step 3 — Plan:**
<what you will do and why, referencing what you found>
[/THOUGHT]

PART 2: Your actual answer starts immediately after [/THOUGHT] on a new line. The answer is NEVER inside the thought block.

For code changes: changed lines only, with enough surrounding context to locate the change.
For analysis/review: numbered findings, each one naming a specific function or file and the exact issue. Show the current code and the improved version side by side. No finding is valid unless it references something from the provided context.
For questions: one clear answer, stop.

## Rules
- All code in triple backtick blocks with the correct language tag
- Never repeat the user's question
- If genuinely ambiguous, ask ONE clarifying question — never guess AND produce output
- Prefer existing patterns and conventions in the codebase
- No obvious or redundant comments in code
- Name specific functions and variables when tracing code flow, not just files
- For code changes: changed lines only, never full rewrites`;

    const userContentWithContext = `
### PROJECT FILES — THE ONLY FILES THAT EXIST IN THIS CODEBASE
\`\`\`
${fileManifest || "File manifest unavailable."}
\`\`\`

${
  fileContext
    ? `### ${isCodeEdit ? "FULL" : "ACTIVE"} FILE: ${foundPath}\n\`\`\`\n${highlightedCode || fileContext}\n\`\`\``
    : "No specific file is currently selected."
}

### BACKGROUND KNOWLEDGE (RAG — hybrid vector + keyword search)
${retrievedContext || "No additional context retrieved."}

### CURRENT REQUEST
${lastUserQuery}`;

    const sharedMessages = [
      { role: "system" as const, content: systemPrompt },
      ...history,
      { role: "user" as const, content: userContentWithContext },
    ];

    // ── Groq path with logged fallback ────────────────────────────────────────
    if (isCloudModel && CLOUD_CONFIG.isConfigured) {
      try {
        const result = await streamText({
          model: groq(effectiveModel),
          messages: sharedMessages,
          ...settings,
        });

        console.log(`--- MITEY [${effectiveModel}] STREAM START (Groq) ---`);
        return buildStreamResponse(
          result.textStream,
          effectiveModel,
          "groq",
          ragSources,
          false,
        );
      } catch (groqError: any) {
        console.error(`\n${"─".repeat(60)}`);
        console.error(
          `[MITEY] ❌ Groq request failed — falling back to local model.`,
        );
        console.error(
          `[MITEY] Groq error type  : ${groqError?.name ?? "Unknown"}`,
        );
        console.error(
          `[MITEY] Groq error status: ${groqError?.status ?? groqError?.statusCode ?? "n/a"}`,
        );
        console.error(
          `[MITEY] Groq error message: ${groqError?.message ?? String(groqError)}`,
        );
        if (groqError?.cause) {
          console.error(
            `[MITEY] Groq error cause : ${JSON.stringify(groqError.cause)}`,
          );
        }
        console.error(`${"─".repeat(60)}\n`);

        // For auth/rate-limit errors, don't silently fall back — tell the user
        const status = groqError?.status ?? groqError?.statusCode;
        if (status === 401 || status === 429) {
          return errorResponse(
            ...(Object.values(
              classifyError(groqError, effectiveModel, "groq"),
            ) as [string, string]),
          );
        }

        // For other Groq errors, fall through to local model
        const fallbackModel = OLLAMA_CONFIG.CHAT_MODEL;
        console.log(`[MITEY] 🔄 Retrying with local model: ${fallbackModel}`);

        try {
          const fallbackResult = await streamText({
            model: ollama(fallbackModel),
            messages: sharedMessages,
            ...getModelSettings(fallbackModel),
          });

          console.log(
            `--- MITEY [${fallbackModel}] STREAM START (Ollama fallback) ---`,
          );
          return buildStreamResponse(
            fallbackResult.textStream,
            fallbackModel,
            "ollama",
            ragSources,
            true,
          );
        } catch (fallbackError: any) {
          const { code, message } = classifyError(
            fallbackError,
            fallbackModel,
            "ollama",
          );
          return errorResponse(
            code,
            `Groq failed and local fallback also failed: ${message}`,
          );
        }
      }
    }

    // ── Local Ollama path ─────────────────────────────────────────────────────
    try {
      const result = await streamText({
        model: ollama(effectiveModel),
        messages: sharedMessages,
        ...settings,
      });

      console.log(`--- MITEY [${effectiveModel}] STREAM START (Ollama) ---`);
      return buildStreamResponse(
        result.textStream,
        effectiveModel,
        "ollama",
        ragSources,
        false,
      );
    } catch (ollamaError: any) {
      const { code, message } = classifyError(
        ollamaError,
        effectiveModel,
        "ollama",
      );
      return errorResponse(code, message);
    }
  } catch (error: any) {
    console.error("MITEY_ERROR:", error);
    return errorResponse(
      "REQUEST_FAILED",
      "Mitey failed to process the request. Check the server logs for details.",
    );
  }
}
