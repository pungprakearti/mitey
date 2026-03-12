import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OllamaEmbeddings } from "@langchain/ollama";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { Document } from "@langchain/core/documents";
import { TARGET_DIR, OLLAMA_CONFIG, miteyConfig } from "./config";
import path from "path";
import fs from "fs/promises";
import type { Dirent } from "fs";
import { create, insert, search, type AnyOrama } from "@orama/orama";
import ignore, { type Ignore } from "ignore";

// ─── Layer 1: Hardcoded directory blocklist ───────────────────────────────────
// Only names that are unambiguously never source code across all ecosystems.
// Anything project-specific is left to .gitignore in Layer 2.
const BLOCKED_DIRS = new Set([
  // Mitey's own generated data — always exclude
  ".mitey_index",
  // Version control
  ".git",
  // JS/TS package managers and build output
  "node_modules",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  // Python
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".tox",
  // JVM / Android
  ".gradle",
  // iOS / macOS
  "Pods",
]);

// ─── Layer 3: File size limit ─────────────────────────────────────────────────
// 100KB is generous for source code (average 2–8KB) but safely below minified
// bundles, compiled output, large fixtures, and lock files.
const MAX_INDEX_SIZE = 100 * 1024;

const BM25_INDEX_PATH = () => path.join(miteyConfig.dbPath, "bm25.json");
const LOCK_FILE_PATH = () => path.join(miteyConfig.dbPath, ".scan_lock");

let oramaDb: AnyOrama | null = null;

const embeddings = new OllamaEmbeddings({
  model: OLLAMA_CONFIG.EMBED_MODEL,
  baseUrl: OLLAMA_CONFIG.HOST,
});

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 600,
  chunkOverlap: 100,
});

// ─── Layer 2: .gitignore loader ───────────────────────────────────────────────
// Loads the root .gitignore if present. Returns null if none exists — callers
// simply skip the filter rather than treating missing .gitignore as an error.

async function loadGitignore(rootDir: string): Promise<Ignore | null> {
  try {
    const raw = await fs.readFile(path.join(rootDir, ".gitignore"), "utf-8");
    return ignore().add(raw);
  } catch {
    return null;
  }
}

// ─── Layer 4: Binary detection ────────────────────────────────────────────────
// Reads the first 512 bytes of a file and checks for null bytes.
// Any null byte means binary content — images, compiled files, SQLite DBs, etc.

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
// Replaces the old getFiles(dir, extensions) function.
// Applies all four filter layers and returns absolute paths of every file that
// should be embedded. Language-agnostic — no extension whitelist.

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
        // Layer 1 — blocked directory names
        if (BLOCKED_DIRS.has(dirent.name)) continue;

        // Layer 2 — .gitignore (directories need trailing slash for correct glob matching)
        if (gitignore && gitignore.ignores(relPath + "/")) continue;

        await walk(fullPath);
        continue;
      }

      // Files only below this point

      // Layer 2 — .gitignore
      if (gitignore && gitignore.ignores(relPath)) continue;

      // Layer 3 — file size
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

      // Layer 4 — binary detection
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

// Backwards-compatible shim so any external caller still using getFiles()
// continues to work. The extensions argument is intentionally ignored.
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

// ─── BM25 index helpers ───────────────────────────────────────────────────────

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

async function saveBM25Index(db: AnyOrama): Promise<void> {
  try {
    const { persist } = await import("@orama/plugin-data-persistence");
    const data = await persist(db, "json");
    await fs.writeFile(BM25_INDEX_PATH(), data as string, "utf-8");
  } catch (e) {
    console.warn("[MITEY] Could not persist BM25 index:", e);
  }
}

async function loadBM25Index(): Promise<AnyOrama | null> {
  try {
    const { restore } = await import("@orama/plugin-data-persistence");
    const raw = await fs.readFile(BM25_INDEX_PATH(), "utf-8");
    const db = await restore("json", raw);
    return db as AnyOrama;
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

export async function hybridSearch(
  query: string,
  vectorStore: HNSWLib,
  k: number = 8,
): Promise<Document[]> {
  const RRF_K = 60;

  const vectorResults = await vectorStore.similaritySearch(query, k);

  let keywordResults: Document[] = [];
  const currentOramaDb = await getBM25Index();
  if (currentOramaDb) {
    try {
      const hits = await search(currentOramaDb, {
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

  addResults(vectorResults, 1);
  addResults(keywordResults, 1);

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
  } catch {
    // Already gone
  }
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
  } catch {
    // Index didn't exist
  }

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

  oramaDb = newOramaDb;

  await vectorStore.save(indexPath);
  await saveBM25Index(oramaDb);

  console.log(
    `[MITEY] ✅ Project indexed (vector + BM25): ${allFilePaths.length} files.`,
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
    if (!oramaDb) {
      oramaDb = await loadBM25Index();
    }
    const allFilePaths = await getIndexableFiles(TARGET_DIR);
    return allFilePaths.map((p) => path.relative(TARGET_DIR, p)).sort();
  } catch {
    // No index — fall through to build
  }

  const acquired = await acquireLock();

  if (!acquired) {
    console.log("[MITEY] ⏳ Another process is indexing. Waiting...");
    await waitForLockRelease();
    if (!oramaDb) {
      oramaDb = await loadBM25Index();
    }
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
  const indexPath = miteyConfig.dbPath;
  console.log(`[MITEY] 🔄 Incremental update for: ${relativeFilePath}`);

  try {
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

    const [newVectorStore, newOramaDb] = await Promise.all([
      HNSWLib.fromDocuments(docsToIndex, embeddings),
      buildBM25Index(docsToIndex),
    ]);

    oramaDb = newOramaDb;

    await newVectorStore.save(indexPath);
    await saveBM25Index(oramaDb);

    console.log(
      `[MITEY] ✨ Incremental update complete (vector + BM25): ${relativeFilePath}`,
    );
  } catch (error) {
    console.error("[MITEY] ❌ Incremental update failed. Rebuilding...", error);
    await scanProject();
  }
}
