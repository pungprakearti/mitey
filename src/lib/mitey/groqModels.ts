import { CLOUD_CONFIG } from "./config";

// Model IDs that are on Groq but are not chat models — transcription, guard, etc.
const GROQ_BLOCKLIST = new Set([
  "whisper-large-v3",
  "whisper-large-v3-turbo",
  "distil-whisper-large-v3-en",
  "llama-guard-3-8b",
]);

// Module-level cache — fetched once per server process, shared across all
// routes that import this module (chat route + models route).
let cachedGroqModels: Set<string> | null = null;
let fetchPromise: Promise<Set<string>> | null = null;

async function fetchGroqModels(): Promise<Set<string>> {
  if (!CLOUD_CONFIG.isConfigured) return new Set();

  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: {
        Authorization: `Bearer ${CLOUD_CONFIG.API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      console.warn(`[MITEY] Groq models API returned ${res.status}`);
      return new Set();
    }

    const data = await res.json();
    const ids: string[] = (data.data ?? [])
      .map((m: any) => m.id as string)
      .filter((id: string) => !GROQ_BLOCKLIST.has(id));

    console.log(`[MITEY] ☁️  Fetched ${ids.length} Groq models.`);
    return new Set(ids);
  } catch (e) {
    console.warn("[MITEY] Could not reach Groq for model list:", e);
    return new Set();
  }
}

/**
 * Returns the cached Groq model set, fetching once if not yet loaded.
 * Concurrent callers share the same in-flight promise so the API is
 * only hit once even if two routes initialise simultaneously.
 */
export async function getGroqModels(): Promise<Set<string>> {
  if (cachedGroqModels !== null) return cachedGroqModels;
  if (!fetchPromise) {
    fetchPromise = fetchGroqModels().then((models) => {
      cachedGroqModels = models;
      fetchPromise = null;
      return models;
    });
  }
  return fetchPromise;
}

/**
 * Returns true if the given model ID is a known Groq cloud model.
 * Uses the cached set — no network call if already loaded.
 */
export async function isGroqModel(modelId: string): Promise<boolean> {
  const models = await getGroqModels();
  return models.has(modelId);
}

/**
 * Returns all Groq model IDs as a sorted array — used by the models route
 * to populate the Sidebar dropdown.
 */
export async function getGroqModelList(): Promise<string[]> {
  const models = await getGroqModels();
  return [...models].sort();
}

/** Invalidate the cache — useful if you want to force a refresh. */
export function invalidateGroqModelCache() {
  cachedGroqModels = null;
  fetchPromise = null;
}
