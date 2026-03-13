import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OllamaEmbeddings } from "@langchain/ollama";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { Document } from "@langchain/core/documents";
import { TARGET_DIR, OLLAMA_CONFIG, miteyConfig } from "./config";
import path from "path";
import fs from "fs/promises";
import type { Dirent } from "fs";
import { create, insertMultiple, search, type AnyOrama } from "@orama/orama";
import { persist, restore } from "@orama/plugin-data-persistence";
import ignore, { type Ignore } from "ignore";

// ─── Layer 1: Hardcoded directory blocklist ───────────────────────────────────
const BLOCKED_DIRS = new Set([
  ".mitey_index",
  ".git",
  "node_modules",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".tox",
  ".gradle",
  "Pods",
]);

// ─── File-level blocklist ─────────────────────────────────────────────────────
const BLOCKED_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "npm-shrinkwrap.json",
  "Gemfile.lock",
  "Cargo.lock",
  "poetry.lock",
  "composer.lock",
  "Pipfile.lock",
  "pubspec.lock",
]);

// Array (not Set) — avoids allocating a new array on every file check
const BLOCKED_EXTENSIONS = [
  ".min.js",
  ".min.css",
  ".map",
  ".pyc",
  ".class",
  ".o",
  ".a",
  ".so",
  ".dylib",
  ".dll",
];

// ─── Layer 3: File size limit ─────────────────────────────────────────────────
const MAX_INDEX_SIZE = 100 * 1024;

const BM25_INDEX_PATH = () => path.join(miteyConfig.dbPath, "bm25.json");
const LOCK_FILE_PATH = () => path.join(miteyConfig.dbPath, ".scan_lock");

let oramaDb: AnyOrama | null = null;

export const embeddings = new OllamaEmbeddings({
  model: OLLAMA_CONFIG.EMBED_MODEL,
  baseUrl: OLLAMA_CONFIG.HOST,
});

// Smaller chunks = more precise retrieval hits.
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 350,
  chunkOverlap: 75,
});

// ─── Module-level caches (shared via exports — route.ts uses these directly) ──

let cachedVectorStore: HNSWLib | null = null;

export async function getVectorStore(): Promise<HNSWLib> {
  if (!cachedVectorStore) {
    console.log("[MITEY] Loading vector store into memory cache...");
    cachedVectorStore = await HNSWLib.load(miteyConfig.dbPath, embeddings);
    console.log("[MITEY] ✅ Vector store cached.");
  }
  return cachedVectorStore;
}

let cachedFileManifest: string | null = null;

export async function getFileManifest(): Promise<string> {
  if (!cachedFileManifest) {
    console.log("[MITEY] Building file manifest cache...");
    const allFilePaths = await getIndexableFiles(TARGET_DIR);
    const relPaths = allFilePaths
      .map((p) => path.relative(TARGET_DIR, p))
      .sort();
    cachedFileManifest = relPaths.slice(0, 80).join("\n");
    console.log("[MITEY] ✅ File manifest cached.");
  }
  return cachedFileManifest;
}

export function invalidateAllCaches(): void {
  cachedVectorStore = null;
  cachedFileManifest = null;
  oramaDb = null;
  console.log("[MITEY] 🔄 All caches invalidated.");
}

// ─── Layer 2: .gitignore loader ───────────────────────────────────────────────
async function loadGitignore(rootDir: string): Promise<Ignore | null> {
  try {
    const raw = await fs.readFile(path.join(rootDir, ".gitignore"), "utf-8");
    return ignore().add(raw);
  } catch {
    return null;
  }
}

// ─── Layer 4: Binary detection ────────────────────────────────────────────────
async function isBinary(filePath: string): Promise<boolean> {
  let fd: fs.FileHandle | null = null;
  try {
    fd = await fs.open(filePath, "r");
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fd.read(buf, 0, 512, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    return true;
  } finally {
    await fd?.close();
  }
}

// ─── getIndexableFiles ────────────────────────────────────────────────────────
export async function getIndexableFiles(rootDir: string): Promise<string[]> {
  const gitignore = await loadGitignore(rootDir);
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of dirents) {
      const fullPath = path.join(dir, dirent.name);
      const relPath = path.relative(rootDir, fullPath);

      if (dirent.isDirectory()) {
        if (BLOCKED_DIRS.has(dirent.name)) continue;
        if (gitignore && gitignore.ignores(relPath + "/")) continue;
        await walk(fullPath);
        continue;
      }

      if (BLOCKED_FILES.has(dirent.name)) continue;
      if (BLOCKED_EXTENSIONS.some((ext) => dirent.name.endsWith(ext))) continue;
      if (gitignore && gitignore.ignores(relPath)) continue;

      let size: number;
      try {
        const stat = await fs.stat(fullPath);
        size = stat.size;
      } catch {
        continue;
      }
      if (size > MAX_INDEX_SIZE) {
        console.log(
          `[MITEY] ⏭  Skipping large file (${Math.round(size / 1024)}KB): ${relPath}`,
        );
        continue;
      }

      if (await isBinary(fullPath)) continue;

      results.push(fullPath);
    }
  }

  await walk(rootDir);
  console.log(
    `[MITEY] 📂 Found ${results.length} indexable files in ${rootDir}`,
  );
  return results;
}

// Backwards-compatible shim
export async function getFiles(dir: string, _ext: string[]): Promise<string[]> {
  return getIndexableFiles(dir);
}

// ─── Document builder ─────────────────────────────────────────────────────────
async function buildDocsFromPaths(filePaths: string[]): Promise<Document[]> {
  const rawDocs = await Promise.all(
    filePaths.map(async (filePath) => {
      const relPath = path.relative(TARGET_DIR, filePath);
      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        return null;
      }
      return new Document({
        pageContent: content,
        metadata: { source: relPath },
      });
    }),
  );

  const validDocs = rawDocs.filter(Boolean) as Document[];
  return splitter.splitDocuments(validDocs);
}

// ─── BM25 helpers ─────────────────────────────────────────────────────────────
async function buildBM25Index(docs: Document[]): Promise<AnyOrama> {
  const db = await create({
    schema: { content: "string", source: "string" },
  });
  await insertMultiple(
    db,
    docs.map((doc) => ({
      content: doc.pageContent,
      source: doc.metadata.source ?? "",
    })),
  );
  return db;
}

async function saveBM25Index(db: AnyOrama): Promise<void> {
  try {
    const data = await persist(db, "json");
    await fs.writeFile(BM25_INDEX_PATH(), data as string, "utf-8");
  } catch (e) {
    console.warn("[MITEY] Could not persist BM25 index:", e);
  }
}

async function loadBM25Index(): Promise<AnyOrama | null> {
  try {
    const raw = await fs.readFile(BM25_INDEX_PATH(), "utf-8");
    return (await restore("json", raw)) as AnyOrama;
  } catch {
    return null;
  }
}

export async function getBM25Index(): Promise<AnyOrama | null> {
  if (!oramaDb) {
    console.log("[MITEY] Loading BM25 index from disk...");
    oramaDb = await loadBM25Index();
    if (oramaDb) {
      console.log("[MITEY] ✅ BM25 index loaded from disk.");
    } else {
      console.log("[MITEY] ⚠️  BM25 index not found on disk.");
    }
  }
  return oramaDb;
}

// ─── Hybrid search ────────────────────────────────────────────────────────────
// Accepts multiple query strings and merges all results via RRF.
// Used by query expansion — each expanded variant runs independently and
// the combined ranking floats the most consistently relevant chunks to the top.

export async function hybridSearch(
  queries: string | string[],
  vectorStore: HNSWLib,
  k: number = 8,
): Promise<Document[]> {
  const RRF_K = 60;
  const queryList = Array.isArray(queries) ? queries : [queries];

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

  const currentOramaDb = await getBM25Index();

  // Run all query variants in parallel
  await Promise.all(
    queryList.map(async (query) => {
      // Vector search
      const vectorResults = await vectorStore.similaritySearch(query, k);
      addResults(vectorResults, 1);

      // BM25 search
      if (currentOramaDb) {
        try {
          const hits = await search(currentOramaDb, {
            term: query,
            limit: k,
            properties: ["content"],
          });
          const keywordResults = hits.hits.map(
            (hit: any) =>
              new Document({
                pageContent: hit.document.content,
                metadata: { source: hit.document.source },
              }),
          );
          addResults(keywordResults, 1);
        } catch (e) {
          console.warn(
            "[MITEY] BM25 search failed for query variant:",
            query,
            e,
          );
        }
      }
    }),
  );

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((entry) => entry.doc);
}

// ─── Lock helpers ─────────────────────────────────────────────────────────────
async function acquireLock(): Promise<boolean> {
  try {
    await fs.mkdir(miteyConfig.dbPath, { recursive: true });
    await fs.writeFile(LOCK_FILE_PATH(), String(process.pid), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

async function releaseLock(): Promise<void> {
  try {
    await fs.unlink(LOCK_FILE_PATH());
  } catch {}
}

async function waitForLockRelease(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fs.access(LOCK_FILE_PATH());
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      return;
    }
  }
  console.warn("[MITEY] ⚠️  Lock wait timed out. Proceeding anyway.");
}

// ─── Core scan ────────────────────────────────────────────────────────────────
async function _runScan(): Promise<string[]> {
  const indexPath = miteyConfig.dbPath;

  try {
    await fs.rm(indexPath, { recursive: true, force: true });
    console.log("[MITEY] 🧹 Stale cache deleted. Performing initial index...");
  } catch {}

  await fs.mkdir(indexPath, { recursive: true });

  const allFilePaths = await getIndexableFiles(TARGET_DIR);
  const splitDocs = await buildDocsFromPaths(allFilePaths);

  const docsToIndex =
    splitDocs.length > 0
      ? splitDocs
      : [
          new Document({
            pageContent: "Empty project — no indexable files found.",
            metadata: { source: "__placeholder__" },
          }),
        ];

  const [vectorStore, newOramaDb] = await Promise.all([
    HNSWLib.fromDocuments(docsToIndex, embeddings),
    buildBM25Index(docsToIndex),
  ]);

  cachedVectorStore = vectorStore;
  oramaDb = newOramaDb;

  await vectorStore.save(indexPath);
  await saveBM25Index(oramaDb);

  console.log(
    `[MITEY] ✅ Project indexed (vector + BM25): ${allFilePaths.length} files, ${docsToIndex.length} chunks.`,
  );
  return allFilePaths.map((p) => path.relative(TARGET_DIR, p)).sort();
}

export async function scanProject(): Promise<string[]> {
  const indexPath = miteyConfig.dbPath;

  try {
    await fs.access(path.join(indexPath, "hnswlib.index"));
    console.log(
      "[MITEY] ⚡ Index exists on disk — loading BM25 and skipping rebuild.",
    );
    if (!oramaDb) oramaDb = await loadBM25Index();
    const allFilePaths = await getIndexableFiles(TARGET_DIR);
    return allFilePaths.map((p) => path.relative(TARGET_DIR, p)).sort();
  } catch {}

  const acquired = await acquireLock();

  if (!acquired) {
    console.log("[MITEY] ⏳ Another process is indexing. Waiting...");
    await waitForLockRelease();
    if (!oramaDb) oramaDb = await loadBM25Index();
    const allFilePaths = await getIndexableFiles(TARGET_DIR);
    return allFilePaths.map((p) => path.relative(TARGET_DIR, p)).sort();
  }

  try {
    return await _runScan();
  } finally {
    await releaseLock();
  }
}

export async function updateFileIndex(relativeFilePath: string) {
  const absolutePath = path.join(TARGET_DIR, relativeFilePath);
  const indexPath = miteyConfig.dbPath;
  console.log(`[MITEY] 🔄 Incremental update for: ${relativeFilePath}`);

  try {
    // Load the existing vector store — only the changed file's chunks get embedded,
    // not the entire project. Note: stale chunks for the edited file accumulate
    // over time; a full rescan (on next cold start) will compact them.
    let vectorStore: HNSWLib;
    try {
      vectorStore =
        cachedVectorStore ?? (await HNSWLib.load(indexPath, embeddings));
    } catch {
      console.log(
        "[MITEY] No existing vector index — falling back to full rebuild.",
      );
      await scanProject();
      return;
    }

    // Check if the file still exists (could be a deletion event)
    const fileExists = await fs
      .access(absolutePath)
      .then(() => true)
      .catch(() => false);

    if (fileExists) {
      const newDocs = await buildDocsFromPaths([absolutePath]);
      if (newDocs.length > 0) {
        await vectorStore.addDocuments(newDocs);
        console.log(
          `[MITEY] 📎 Added ${newDocs.length} chunks for ${relativeFilePath}`,
        );
      }
    }

    await vectorStore.save(indexPath);
    cachedVectorStore = vectorStore;

    // BM25: full rebuild — no embedding calls, CPU-only, fast
    const allFilePaths = await getIndexableFiles(TARGET_DIR);
    const allDocs = await buildDocsFromPaths(allFilePaths);
    const newOramaDb = await buildBM25Index(allDocs);
    oramaDb = newOramaDb;
    await saveBM25Index(oramaDb);

    // Invalidate manifest so next request reflects any new/removed files
    cachedFileManifest = null;

    console.log(
      `[MITEY] ✨ Incremental update complete: ${relativeFilePath}`,
    );
  } catch (error) {
    console.error("[MITEY] ❌ Incremental update failed. Rebuilding...", error);
    await scanProject();
  }
}
