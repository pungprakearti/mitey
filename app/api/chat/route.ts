import { createOpenAI } from "@ai-sdk/openai";
import { createGroq } from "@ai-sdk/groq";
import { streamText, generateText } from "ai";
import {
  TARGET_DIR,
  OLLAMA_CONFIG,
  CLOUD_CONFIG,
  getModelSettings,
} from "@/lib/mitey/config";
import fs from "fs/promises";
import path from "path";
import {
  getVectorStore,
  getFileManifest,
  hybridSearch,
} from "@/lib/mitey/scanner";
import { isGroqModel } from "@/lib/mitey/groqModels";

// ─── Provider clients ─────────────────────────────────────────────────────────

const ollama = createOpenAI({
  baseURL: OLLAMA_CONFIG.V1,
  apiKey: "ollama",
});

const groq = createGroq({
  apiKey: CLOUD_CONFIG.API_KEY || "no-key",
});

// ─── Query expansion ──────────────────────────────────────────────────────────

async function expandQuery(query: string, model: any): Promise<string[]> {
  try {
    const { text } = await generateText({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a code search assistant. Given a user's question about a codebase, output exactly 3 short search queries (one per line, no numbering, no punctuation at end) that would retrieve the most relevant source code from a vector + keyword index. Focus on technical terms, function names, component names, and implementation concepts. Output ONLY the 3 queries, nothing else.",
        },
        { role: "user", content: query },
      ],
      temperature: 0.3,
      maxOutputTokens: 80,
    });

    const variants = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3);

    const deduped = [...new Set([query, ...variants])];
    console.log(`[MITEY] 🔍 Query expansion: ${deduped.join(" | ")}`);
    return deduped;
  } catch (e) {
    console.warn("[MITEY] Query expansion failed, using original:", e);
    return [query];
  }
}

// ─── Fuzzy component name → file injection ────────────────────────────────────

function extractComponentCandidates(query: string): string[] {
  const candidates: string[] = [];
  const pascalMatches = query.match(/\b[A-Z][a-zA-Z]+\b/g) ?? [];
  candidates.push(...pascalMatches);
  const contextMatches =
    query.match(
      /\b(\w+)\s+(?:component|hook|function|file|module|util|service|page|route|handler)\b/gi,
    ) ?? [];
  contextMatches.forEach((m) => {
    const word = m.split(/\s+/)[0];
    if (word) candidates.push(word);
  });
  return [...new Set(candidates.map((c) => c.toLowerCase()))];
}

async function findFuzzyFileMatch(
  candidates: string[],
  manifestFiles: string[],
): Promise<{ content: string; relPath: string } | null> {
  for (const candidate of candidates) {
    const match = manifestFiles.find((f) => {
      const base = path.basename(f, path.extname(f)).toLowerCase();
      return base === candidate || base === candidate + "s";
    });
    if (match) {
      console.log(
        `[MITEY] 🔎 Fuzzy component match: "${candidate}" → ${match}`,
      );
      try {
        const content = await fs.readFile(
          path.join(TARGET_DIR, match),
          "utf-8",
        );
        return { content, relPath: match };
      } catch {
        continue;
      }
    }
  }
  return null;
}

// ─── Agent classifier ─────────────────────────────────────────────────────────

async function classifyIsCodeEdit(query: string, model: any): Promise<boolean> {
  const QUESTION_PATTERN =
    /^(what|how|why|where|when|who|which|can you explain|tell me|describe|show me how|walk me through|is there|are there|does|do )/i;
  if (QUESTION_PATTERN.test(query.trim())) return false;

  try {
    const { text } = await generateText({
      model,
      messages: [
        {
          role: "system",
          content:
            'Classify the following message as either "action" (the user wants code to be written, edited, refactored, fixed, added, removed, renamed, or otherwise changed) or "question" (the user wants an explanation, analysis, or information). Reply with exactly one word: action or question.',
        },
        { role: "user", content: query },
      ],
      temperature: 0,
      maxOutputTokens: 5,
    });
    const isAction = text.trim().toLowerCase().includes("action");
    console.log(
      `[MITEY] 🏷  Classifier: ${isAction ? "Code Agent" : "General Agent"}`,
    );
    return isAction;
  } catch {
    const CODE_EDIT_PATTERN =
      /\b(fix|change|update|refactor|rename|add|remove|replace|modify|rewrite|delete|move|extract|split|merge|convert|implement|create)\b/i;
    return CODE_EDIT_PATTERN.test(query);
  }
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

    const fastModel = ollama(OLLAMA_CONFIG.CHAT_MODEL);

    // ── Phase 1: classify + manifest + active file read (all parallel) ────────
    const [isCodeEdit, fileManifest, rawActiveFileContent] = await Promise.all([
      classifyIsCodeEdit(lastUserQuery, fastModel),
      getFileManifest().catch(() => ""),
      activeFile
        ? fs
            .readFile(path.join(TARGET_DIR, activeFile), "utf-8")
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    const manifestFiles = fileManifest.split("\n").filter(Boolean);

    // ── Model selection ───────────────────────────────────────────────────────
    const selectedModel = isCodeEdit
      ? codeEditModel || OLLAMA_CONFIG.CHAT_MODEL
      : generalModel || OLLAMA_CONFIG.CHAT_MODEL;

    const isCloudModel =
      CLOUD_CONFIG.isConfigured && (await isGroqModel(selectedModel));

    console.log(`\n${"═".repeat(60)}`);
    console.log(`[MITEY] 📝 Query: ${lastUserQuery}`);
    console.log(
      `[MITEY] 🤖 Agent: ${isCodeEdit ? "Code Agent" : "General Agent"} → ${selectedModel}${isCloudModel ? " ☁️  (Groq)" : " 🖥️  (Ollama)"}`,
    );
    console.log(`${"═".repeat(60)}\n`);

    if (isCodeEdit) {
      console.log(`[MITEY] 🔧 Code edit detected — injecting full file.`);
    }

    const settings = getModelSettings(selectedModel);

    const history = messages.slice(-10, -1).map((m: any) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));

    // ── Phase 2: file lookup + query expansion + vector store (parallel) ──────
    const fileMatch = lastUserQuery.match(
      /([a-zA-Z0-9_\-\/]+\.(?:tsx?|jsx?|json|md))/i,
    );

    let fileContextPromise: Promise<{
      content: string;
      relPath: string;
    } | null>;

    if (fileMatch && !activeFile) {
      const targetName = fileMatch[1];
      const found = manifestFiles.find(
        (f) => f.endsWith(targetName) || path.basename(f) === targetName,
      );
      if (found) {
        console.log(
          `[MITEY] 🔎 File lookup: found "${targetName}" in manifest`,
        );
        fileContextPromise = fs
          .readFile(path.join(TARGET_DIR, found), "utf-8")
          .then((content) => ({ content, relPath: found }))
          .catch(() => null);
      } else {
        console.log(`[MITEY] ⚠️  File not found in manifest: ${targetName}`);
        fileContextPromise = Promise.resolve(null);
      }
    } else if (rawActiveFileContent !== null) {
      fileContextPromise = Promise.resolve({
        content: rawActiveFileContent,
        relPath: activeFile,
      });
    } else {
      const candidates = extractComponentCandidates(lastUserQuery);
      fileContextPromise =
        candidates.length > 0
          ? findFuzzyFileMatch(candidates, manifestFiles)
          : Promise.resolve(null);
    }

    const [fileResult, expandedQueries, vectorStore] = await Promise.all([
      fileContextPromise,
      expandQuery(lastUserQuery, fastModel),
      getVectorStore(),
    ]);

    // ── Assemble file context ─────────────────────────────────────────────────
    let fileContext = "";
    let foundPath = activeFile || "";

    if (fileResult) {
      const raw = fileResult.content;
      foundPath = fileResult.relPath;

      if (fileMatch && !activeFile) {
        fileContext = raw;
        console.log(`[MITEY] ✅ File loaded: ${foundPath}`);
      } else if (rawActiveFileContent !== null) {
        fileContext = isCodeEdit ? raw : raw.slice(0, 12000);
        console.log(
          `[MITEY] ✅ Active file loaded: ${activeFile} (${isCodeEdit ? "full" : "12k slice"})`,
        );
      } else {
        fileContext = raw.slice(0, 12000);
      }
    }

    // ── Phase 3: hybrid search ────────────────────────────────────────────────
    let retrievedContext = "";
    let ragSources: string[] = [];

    try {
      const searchResults = await hybridSearch(expandedQueries, vectorStore, 8);
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

    const systemPrompt = `You are Mitey, a senior staff engineer who lives inside the user's codebase. You have read access to every file and have retrieved the most relevant chunks via hybrid semantic + keyword search. You think carefully before answering and you never make things up.

## WHO YOU ARE
You are not a tutor, not a chatbot, and not a documentation generator. You are the most experienced engineer on the team — the one people come to when they're stuck, when something is broken, or when they want to understand how a system actually works. Your answers are grounded, specific, and actionable. You show the code, you name the function, you trace the call chain. You do not give advice that could apply to any codebase — everything you say is anchored to what you can see in this one.

## BEFORE YOU ANSWER — THINK THROUGH THESE IN ORDER
Work through all of these inside your [THOUGHT] block before writing a single word of your actual answer:

1. What is the user actually asking? Is it a question, a code change request, or a pattern analysis? Be precise about the intent.
2. What files and functions in the retrieved context are directly relevant? Name them exactly. If a file you'd expect to see wasn't retrieved, say so — don't pretend it was.
3. If the question involves a repeated pattern or design decision: examine EACH instance individually. Ask for each one — is this intentional, or accidental? What was the author likely trying to do here? Do NOT form a conclusion until you've reasoned about every instance. Intentional instances and accidental ones must be treated separately in your answer.
4. What is your plan? If it's a code change — what exactly changes and where? If it's an explanation — what is the call chain you'll trace? If it's a pattern analysis — which instances are fine, which need work?
5. Self-check before writing your answer: (a) Am I about to name a specific file or function? (b) Is there any sentence that could apply to any codebase? If yes, rewrite it. (c) For code changes — am I about to show only the changed block? (d) For pattern questions — am I distinguishing intentional from accidental?

## HOW TO STRUCTURE YOUR RESPONSE

Open with your reasoning:

[THOUGHT]
**What is being asked:**
<intent — be precise>

**Relevant code located:**
<exact files, function names, and key lines from the retrieved context — if something is missing from context, name it and explain what you can still answer>

**Instance-by-instance analysis** (only for pattern/design questions):
<for each instance of the pattern: location, likely intent, verdict — intentional or worth changing>

**Plan:**
<exactly what you will say or change and why>
[/THOUGHT]

Then your answer immediately after [/THOUGHT] — never inside the thought block.

## OUTPUT FORMAT BY REQUEST TYPE

**Simple questions** (what is X, what does Y do, overview questions):
2-3 sentences of plain prose maximum. No headers. No numbered lists. No bullet points. No "in summary". If you find yourself starting a list, stop and rewrite as a single paragraph. The question is answered when the core fact is stated — stop there.

**Questions and walkthroughs:**
Prose. Trace the actual call chain by function name. Every claim cites a specific file or function. Stop when the question is answered — no padding, no "in summary".

**Pattern and design analysis:**
Two clearly labelled sections — "Intentional and correct" listing instances that are fine and why, then "Worth changing" listing instances that should be improved with specific suggestions. Never a blanket verdict across all instances.

**Code changes:**
The changed function or block only. 2-3 lines of surrounding context to locate it. No full file. No diff format unless explicitly asked. One code block per logical change.

## HARD RULES
- Never invent file paths, function names, or imports. The manifest is the ground truth.
- Never give generic advice. If a sentence could appear in a Stack Overflow answer about any React app, rewrite it to reference this codebase specifically.
- "I don't have enough context" is only valid for specific missing facts (a line number, a variable name). It is never valid for analysis, architecture, or review questions.
- No obvious comments in code. No restating the question. No "great question".
- If genuinely ambiguous, ask exactly one clarifying question. Never guess and produce output at the same time.
- Simple questions get simple answers. Do not pad a one-sentence answer into a list.
- NEVER use numbered lists or bullet points to answer a simple "what is" or "what does" question. If the answer has no code and needs no file citations, it must be plain prose under 4 sentences. Producing a structured list for a simple question is a failure.`;

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

    // ── Select provider ───────────────────────────────────────────────────────
    const modelInstance =
      isCloudModel && CLOUD_CONFIG.isConfigured
        ? groq(selectedModel)
        : ollama(selectedModel);

    const result = await streamText({
      model: modelInstance,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userContentWithContext },
      ],
      ...settings,
    });

    console.log(`--- MITEY [${selectedModel}] STREAM START ---`);

    const logStream = new TransformStream({
      transform(chunk, controller) {
        process.stdout.write(chunk);
        controller.enqueue(chunk);
      },
      flush() {
        console.log(`\n--- MITEY [${selectedModel}] STREAM END ---\n`);
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
