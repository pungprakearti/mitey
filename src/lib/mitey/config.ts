import path from "path";

// TARGET_DIR is set by the CLI (bin/cli.js) via MITEY_TARGET_DIR env var.
// Falls back to process.cwd() for local development.
export const TARGET_DIR = process.env.MITEY_TARGET_DIR || process.cwd();

export const OLLAMA_CONFIG = {
  HOST: "http://127.0.0.1:11434",
  get V1() {
    return `${this.HOST}/v1`;
  },
  // MITEY_MODEL env var lets users override the default without editing code
  CHAT_MODEL: process.env.MITEY_MODEL || "qwen2.5-coder:7b",
  EMBED_MODEL: "nomic-embed-text",
};

export const miteyConfig = {
  dbPath: path.join(TARGET_DIR, ".mitey_index"),
};

// Auto-tune generation settings based on model size
export const getModelSettings = (modelName: string) => {
  const lower = modelName.toLowerCase();
  const isSmallModel =
    lower.includes("7b") || lower.includes("8b") || lower.includes("3b");

  return {
    temperature: 0.2,
  };
};
