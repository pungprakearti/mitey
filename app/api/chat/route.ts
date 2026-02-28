import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { scanProject } from "@/lib/mitey/scanner";
import { TARGET_DIR } from "@/lib/mitey/config";
import fs from "fs/promises";
import path from "path";

// Connect to your local Ollama instance
const ollama = createOpenAI({
  baseURL: "http://127.0.0.1:11434/v1",
  apiKey: "ollama",
});

/**
 * Reads file content safely from the TARGET_DIR defined in config
 */
async function getFileContent(relativeFilePath: string) {
  try {
    const fullPath = path.join(TARGET_DIR, relativeFilePath);
    const content = await fs.readFile(fullPath, "utf-8");
    return content;
  } catch (error) {
    console.error(
      `[MITEY READER ERROR]: Could not read ${relativeFilePath} at ${TARGET_DIR}`,
      error,
    );
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    const lastUserMessage = messages[messages.length - 1]?.content || "";

    // 1. Get the list of project files
    const allFilePaths = await scanProject();

    let contextSnippet = "";
    console.log(`--- Mitey Scanning Path: ${TARGET_DIR} ---`);

    // 2. Look for mentions of files in the user's prompt
    for (const filePath of allFilePaths) {
      const baseName = path.basename(filePath);

      const isMentioned =
        lastUserMessage.toLowerCase().includes(baseName.toLowerCase()) ||
        lastUserMessage.toLowerCase().includes(filePath.toLowerCase());

      if (isMentioned) {
        console.log(`[MITEY MATCH]: Found ${filePath}. Reading content...`);
        const content = await getFileContent(filePath);
        if (content) {
          contextSnippet += `\n--- START OF FILE: ${filePath} ---\n${content}\n--- END OF FILE ---\n`;
        }
      }
    }

    // 3. Generate response with the real file contents
    const result = await streamText({
      model: ollama("qwen2.5-coder:7b"),
      system: `Your name is Mitey. You are small, but mighty! 
               You are a highly skilled assistant.
               Project Root: ${TARGET_DIR}
               
               IMPORTANT: If you see 'START OF FILE' blocks below, that is the ACTUAL code from the disk. 
               Do NOT say you cannot access files.
               
               AVAILABLE FILES: ${allFilePaths.join(", ")}
               
               ${
                 contextSnippet
                   ? `CURRENT CONTEXT:\n${contextSnippet}`
                   : "The user might ask about the files listed above. If they mention one, I will provide the content in the next turn."
               }
               
               Rules:
               1. Use the 'CURRENT CONTEXT' code blocks as your source of truth.
               2. Always state exactly which file you are referring to.
               3. If code is provided, explain it block by block as requested.`,
      messages,
    });

    return result.toTextStreamResponse();
  } catch (error: any) {
    console.error("[MITEY CHAT ERROR]:", error);
    return new Response(
      JSON.stringify({ error: "Mitey encountered an error. Check terminal!" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
