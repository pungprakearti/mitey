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

const ollama = createOpenAI({
  baseURL: OLLAMA_CONFIG.V1,
  apiKey: "ollama",
});

const embeddings = new OllamaEmbeddings({
  model: OLLAMA_CONFIG.EMBED_MODEL,
  baseUrl: OLLAMA_CONFIG.HOST,
});

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

export async function POST(req: Request) {
  try {
    const { messages, activeFile, highlightedCode, selectedModel } =
      await req.json();

    // DIAGNOSTIC: Check the incoming model
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

    // 1. Librarian Lookup
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

    // 2. Vector Search
    try {
      const vectorStore = await HNSWLib.load(miteyConfig.dbPath, embeddings);
      const searchResults = await vectorStore.similaritySearch(
        lastUserQuery,
        5,
      );
      retrievedContext = searchResults
        .map((doc) => `[CONTEXT: ${doc.metadata.source}]\n${doc.pageContent}`)
        .join("\n\n---\n\n");
    } catch (e) {
      console.log("[MITEY] Vector skip.");
    }

    // 3. System Prompt
    const systemPrompt = `
### ROLE
You are Mitey, a Senior Staff Engineer. 

### MANDATORY FORMAT
1. Start with [THOUGHT]
2. Acknowledge the user's background and plan the fix.
3. You MUST end the thinking phase with the literal string: [/THOUGHT]
4. Start the code or response immediately after the closing tag.

### STRICT RULES
- ALL code must be in triple backtick blocks.
- Focus strictly on the requested change.`;

    const userContentWithContext = `
${fileContext ? `### ACTIVE FILE CONTENT: ${foundPath}\n\`\`\`\n${highlightedCode || fileContext}\n\`\`\`` : "No specific file content provided."}

### BACKGROUND KNOWLEDGE (RAG)
${retrievedContext}

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
      providerOptions: {
        openai: {
          config: {
            num_ctx: 16384,
            num_predict: 3500,
          },
        },
      },
    });

    // 4. Diagnostic Logging
    console.log(`\n--- MITEY [${currentModel}] RAW STREAM START ---`);

    const logStream = new TransformStream({
      transform(chunk, controller) {
        process.stdout.write(chunk);
        controller.enqueue(chunk);
      },
      flush() {
        console.log(`\n--- MITEY [${currentModel}] RAW STREAM END ---\n`);
      },
    });

    const responseStream = result.textStream.pipeThrough(logStream);

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate", // Prevent caching
      },
    });
  } catch (error) {
    console.error("MITEY_ERROR:", error);
    return new Response("Mitey Error", { status: 500 });
  }
}
