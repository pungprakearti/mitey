import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { TARGET_DIR } from "@/lib/mitey/config";
import fs from "fs/promises";
import path from "path";

const ollama = createOpenAI({
  baseURL: "http://127.0.0.1:11434/v1",
  apiKey: "ollama",
});

async function getFileContent(relativeFilePath: string) {
  try {
    const fullPath = path.join(TARGET_DIR, relativeFilePath);
    return await fs.readFile(fullPath, "utf-8");
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { messages, activeFile, highlightedCode } = await req.json();

    let fileContext = "";
    if (activeFile) {
      const content = await getFileContent(activeFile);
      // Keep context light (500 chars) to stay within the 2.4GB free VRAM
      fileContext = content ? content.slice(0, 500) : "";
    }

    const lastUserQuery = messages[messages.length - 1]?.content || "";

    // We merge the instructions into a single user message.
    // This "flattens" the logic so the model doesn't get confused.
    const prompt = `
Context Code:
\`\`\`
${highlightedCode || fileContext}
\`\`\`

Question: ${lastUserQuery}

Instruction: You are Mitey, a senior engineer. Provide a detailed, 3-paragraph technical explanation.

Response: 
Certainly! Analyzing that for you now. In this specific code snippet, the logic is responsible for`.trim();

    const result = await streamText({
      model: ollama("qwen2.5-coder:7b"),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      // Use the spread operator to ensure type safety if needed,
      // or pass via providerOptions for Ollama specific tuning.
      providerOptions: {
        openai: {
          max_tokens: 1000,
        },
      },
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error("MITEY_ERROR:", error);
    return new Response("Mitey Error", { status: 500 });
  }
}
