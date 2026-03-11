import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OllamaEmbeddings } from "@langchain/ollama";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { Document } from "@langchain/core/documents";
import { TARGET_DIR, OLLAMA_CONFIG, miteyConfig } from "./config";
import path from "path";
import fs from "fs/promises";
import { create, insert, search, type AnyOrama } from "@orama/orama";

export const supportedExtensions = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".md",
];
const MAX_INDEX_SIZE = 500 * 1024;

// Path where the BM25 keyword index is saved alongside the vector store
const BM25_INDEX_PATH = () => path.join(miteyConfig.dbPath, "bm25.json");

let hasIndexedThisSession = false;

// In-memory BM25 index — rebuilt on startup alongside the vector store.
// Orama is fully in-process so there's no server or network call.
let oramaDb: AnyOrama | null = null;

const embeddings = new OllamaEmbeddings({
  model: OLLAMA_CONFIG.EMBED_MODEL,
  baseUrl: OLLAMA_CONFIG.HOST,
});

// Smaller chunks = more precise retrieval hits.
// 600/100 outperforms 1000/200 for targeted code questions.
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 600,
  chunkOverlap: 100,
});

// Exported so chat_route.ts can build the file manifest without re-implementing this
export async function getFiles(dir: string, ext: string[]): Promise<string[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    dirents.map(async (dirent): Promise<string | string[]> => {
      const res = path.resolve(dir, dirent.name);
      if (dirent.name === "node_modules" || dirent.name.startsWith("."))
        return [];
      if (dirent.isDirectory()) return getFiles(res, ext);
      return ext.includes(path.extname(res)) ? res : [];
    }),
  );
  return (await Promise.all(files)).flat(Infinity).filter(Boolean) as string[];
}

async function buildDocsFromPaths(filePaths: string[]): Promise<Document[]> {
  const rawDocs = await Promise.all(
    filePaths.map(async (filePath) => {
      const stats = await fs.stat(filePath);
      const relPath = path.relative(TARGET_DIR, filePath);

      if (stats.size > MAX_INDEX_SIZE) {
        return new Document({
          pageContent: "File too large to index.",
          metadata: { source: relPath, tooLarge: true },
        });
      }
      const content = await fs.readFile(filePath, "utf-8");
      return new Document({
        pageContent: content,
        metadata: { source: relPath },
      });
    }),
  );
  return splitter.splitDocuments(rawDocs);
}

/**
 * Build an Orama BM25 full-text index from a list of split documents.
 * Each document chunk becomes a searchable record with its source path.
 */
async function buildBM25Index(docs: Document[]): Promise<AnyOrama> {
  const db = await create({
    schema: {
      content: "string",
      source: "string",
    },
  });

  for (const doc of docs) {
    await insert(db, {
      content: doc.pageContent,
      source: doc.metadata.source ?? "",
    });
  }

  return db;
}

/**
 * Persist the BM25 index to disk as JSON so it survives across
 * requests within the same session (Orama supports plain JSON export).
 */
async function saveBM25Index(db: AnyOrama): Promise<void> {
  try {
    const { persist } = await import("@orama/plugin-data-persistence");
    const data = await persist(db, "json");
    await fs.writeFile(BM25_INDEX_PATH(), data as string, "utf-8");
  } catch (e) {
    console.warn("[MITEY] Could not persist BM25 index:", e);
  }
}

/**
 * Load the BM25 index from disk. Falls back to null if unavailable,
 * in which case the next scanProject() call will rebuild it.
 */
async function loadBM25Index(): Promise<AnyOrama | null> {
  try {
    const { restore } = await import("@orama/plugin-data-persistence");
    const raw = await fs.readFile(BM25_INDEX_PATH(), "utf-8");
    const db = await restore("json", raw);
    return db as AnyOrama;
  } catch (e) {
    return null;
  }
}

/**
 * Hybrid search using Reciprocal Rank Fusion (RRF).
 *
 * How RRF works:
 *   Each result list (vector and keyword) ranks documents 1..N.
 *   Every document gets a score = 1 / (rank + K) for each list it appears in.
 *   K=60 is the standard constant — it softens the impact of very high ranks.
 *   Scores from both lists are summed, then sorted descending.
 *
 * This means a document that ranks #1 in keyword search and #3 in vector
 * search will outscore one that only appears in one list at rank #1.
 * The result: exact matches AND semantic matches both bubble up.
 */
export async function hybridSearch(
  query: string,
  vectorStore: HNSWLib,
  k: number = 8,
): Promise<Document[]> {
  const RRF_K = 60;

  // --- Vector search ---
  const vectorResults = await vectorStore.similaritySearch(query, k);

  // --- Keyword / BM25 search ---
  let keywordResults: Document[] = [];
  if (oramaDb) {
    try {
      const hits = await search(oramaDb, {
        term: query,
        limit: k,
        properties: ["content"],
      });
      keywordResults = hits.hits.map(
        (hit: any) =>
          new Document({
            pageContent: hit.document.content,
            metadata: { source: hit.document.source },
          }),
      );
    } catch (e) {
      console.warn(
        "[MITEY] BM25 search failed, falling back to vector only:",
        e,
      );
    }
  }

  // --- Reciprocal Rank Fusion ---
  // Use pageContent as a stable key to identify the same chunk across both lists
  const scores = new Map<string, { doc: Document; score: number }>();

  const addResults = (results: Document[], weight: number = 1) => {
    results.forEach((doc, rank) => {
      const key = doc.pageContent;
      const rrfScore = weight * (1 / (rank + 1 + RRF_K));
      if (scores.has(key)) {
        scores.get(key)!.score += rrfScore;
      } else {
        scores.set(key, { doc, score: rrfScore });
      }
    });
  };

  // Give both sources equal weight — adjust if you want to favour one
  addResults(vectorResults, 1);
  addResults(keywordResults, 1);

  // Sort by combined RRF score descending and return top k
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((entry) => entry.doc);
}

export async function scanProject(): Promise<string[]> {
  const indexPath = miteyConfig.dbPath;

  if (!hasIndexedThisSession) {
    try {
      await fs.rm(indexPath, { recursive: true, force: true });
      console.log(
        "[MITEY] 🧹 Stale cache deleted. Performing initial index...",
      );
      hasIndexedThisSession = true;
    } catch (e) {
      // Index didn't exist — that's fine
    }
  } else {
    try {
      await fs.access(indexPath);
      console.log("[MITEY] ⚡ Index already fresh. Skipping full rebuild.");

      // Load BM25 index into memory if not already loaded
      if (!oramaDb) {
        oramaDb = await loadBM25Index();
        if (oramaDb) {
          console.log("[MITEY] ⚡ BM25 index loaded from disk.");
        }
      }

      const allFilePaths = await getFiles(TARGET_DIR, supportedExtensions);
      return allFilePaths.map((p) => path.relative(TARGET_DIR, p)).sort();
    } catch {
      console.log("[MITEY] ⚠️ Index missing, rebuilding...");
    }
  }

  const allFilePaths = await getFiles(TARGET_DIR, supportedExtensions);
  const splitDocs = await buildDocsFromPaths(allFilePaths);

  // Build both indexes in parallel
  const [vectorStore, newOramaDb] = await Promise.all([
    HNSWLib.fromDocuments(splitDocs, embeddings),
    buildBM25Index(splitDocs),
  ]);

  oramaDb = newOramaDb;

  // Save both indexes to disk
  await vectorStore.save(indexPath);
  await saveBM25Index(oramaDb);

  console.log(
    `[MITEY] ✅ Project indexed (vector + BM25): ${allFilePaths.length} files.`,
  );
  return allFilePaths.map((p) => path.relative(TARGET_DIR, p)).sort();
}

export async function updateFileIndex(relativeFilePath: string) {
  const indexPath = miteyConfig.dbPath;
  const fullPath = path.join(TARGET_DIR, relativeFilePath);

  console.log(`[MITEY] 🔄 Incremental update for: ${relativeFilePath}`);

  try {
    const allFilePaths = await getFiles(TARGET_DIR, supportedExtensions);
    const splitDocs = await buildDocsFromPaths(allFilePaths);

    await fs.access(fullPath);

    // Rebuild both indexes
    const [newVectorStore, newOramaDb] = await Promise.all([
      HNSWLib.fromDocuments(splitDocs, embeddings),
      buildBM25Index(splitDocs),
    ]);

    oramaDb = newOramaDb;

    await newVectorStore.save(indexPath);
    await saveBM25Index(oramaDb);

    console.log(
      `[MITEY] ✨ Incremental update complete (vector + BM25): ${relativeFilePath}`,
    );
  } catch (error) {
    console.error("[MITEY] ❌ Incremental update failed. Rebuilding...", error);
    hasIndexedThisSession = false;
    await scanProject();
  }
}
