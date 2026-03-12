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
  CHAT_MODEL: process.env.MITEY_MODEL || "qwen2.5-coder:14b",
  EMBED_MODEL: "nomic-embed-text",
};

// ─── Cloud provider config ────────────────────────────────────────────────────
// Groq hosts qwen/qwen3-32b on their free tier with no credit card required.
// 1,000 requests/day free, ~400 tokens/sec inference speed.
// Get a free API key at: https://console.groq.com/keys
// Add it to .env.local as GROQ_API_KEY=your-key-here
export const CLOUD_CONFIG = {
  // Llama 4 Scout: 30K TPM free tier — highest headroom of any free Groq model
  // Strong on code, 131K context, latest Meta generation
  CODE_EDIT_MODEL: "meta-llama/llama-4-scout-17b-16e-instruct",
  // Read the API key from environment — never hardcode this
  API_KEY: process.env.GROQ_API_KEY || "",
  get isConfigured() {
    return this.API_KEY.length > 0;
  },
};

export const miteyConfig = {
  dbPath: path.join(TARGET_DIR, ".mitey_index"),
};

export const getModelSettings = (_modelName: string) => {
  return {
    temperature: 0.2,
  };
};
