import path from "path";

export const TARGET_DIR = process.cwd();

export const OLLAMA_CONFIG = {
  HOST: "http://127.0.0.1:11434",
  get V1() {
    return `${this.HOST}/v1`;
  },
  CHAT_MODEL: "qwen2.5-coder:7b", // Default fallback
  EMBED_MODEL: "nomic-embed-text",
};

export const miteyConfig = {
  dbPath: path.join(TARGET_DIR, ".mitey_index"),
};

// Auto-tuning settings based on model intelligence
export const getModelSettings = (modelName: string) => {
  const isSmallModel =
    modelName.toLowerCase().includes("7b") ||
    modelName.toLowerCase().includes("8b");

  return {
    temperature: 0.2,
    // Only apply penalties to models that need the help
    frequencyPenalty: isSmallModel ? 0.5 : 0,
    presencePenalty: isSmallModel ? 0.3 : 0,
  };
};
