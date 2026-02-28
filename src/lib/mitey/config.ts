import { ChatOllama } from "@langchain/ollama";
import { OllamaEmbeddings } from "@langchain/ollama";
import path from "path";

// Prioritize the environment variable, then fallback to your specific path
export const TARGET_DIR =
  process.env.MITEY_TARGET_DIR || "/home/andrew/bin/rag-code-help";

export const miteyConfig = {
  model: new ChatOllama({
    model: "qwen2.5-coder:7b",
    temperature: 0,
    numPredict: -1,
    numCtx: 8192,
  }),
  embeddings: new OllamaEmbeddings({
    model: "nomic-embed-text",
  }),
  // Stores the vector database inside the project being scanned
  dbPath: path.join(TARGET_DIR, "./.mitey_index"),
};
