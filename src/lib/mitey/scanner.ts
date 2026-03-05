import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OllamaEmbeddings } from "@langchain/ollama";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { Document } from "@langchain/core/documents";
import { TARGET_DIR, OLLAMA_CONFIG, miteyConfig } from "./config";
import path from "path";
import fs from "fs/promises";

const supportedExtensions = [".js", ".jsx", ".ts", ".tsx", ".json", ".md"];
const MAX_INDEX_SIZE = 500 * 1024;

let hasIndexedThisSession = false;

const embeddings = new OllamaEmbeddings({
  model: OLLAMA_CONFIG.EMBED_MODEL,
  baseUrl: OLLAMA_CONFIG.HOST,
});

async function getFiles(dir: string, ext: string[]): Promise<string[]> {
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

export async function scanProject(): Promise<string[]> {
  const indexPath = miteyConfig.dbPath;

  if (!hasIndexedThisSession) {
    try {
      await fs.rm(indexPath, { recursive: true, force: true });
      console.log(
        "[MITEY] 🧹 Stale cache deleted. Performing initial session index...",
      );
      hasIndexedThisSession = true;
    } catch (e) {
      // Index didn't exist, fine
    }
  } else {
    try {
      await fs.access(indexPath);
      console.log("[MITEY] ⚡ Index already fresh. Skipping full rebuild.");
      const allFilePaths = await getFiles(TARGET_DIR, supportedExtensions);
      return allFilePaths.map((p) => path.relative(TARGET_DIR, p)).sort();
    } catch {
      console.log("[MITEY] ⚠️ Index missing, rebuilding...");
    }
  }

  const allFilePaths = await getFiles(TARGET_DIR, supportedExtensions);
  const rawDocs: Document[] = await Promise.all(
    allFilePaths.map(async (filePath) => {
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

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const splitDocs = await splitter.splitDocuments(rawDocs);

  const vectorStore = await HNSWLib.fromDocuments(splitDocs, embeddings);
  await vectorStore.save(indexPath);

  console.log(`[MITEY] ✅ Project indexed: ${allFilePaths.length} files.`);
  return allFilePaths.map((p) => path.relative(TARGET_DIR, p)).sort();
}

export async function updateFileIndex(relativeFilePath: string) {
  const indexPath = miteyConfig.dbPath;
  const fullPath = path.join(TARGET_DIR, relativeFilePath);

  console.log(
    `[MITEY] 🔄 Starting clean incremental update for: ${relativeFilePath}`,
  );

  try {
    const vectorStore = await HNSWLib.load(indexPath, embeddings);

    const currentDocs = vectorStore.docstore._docs;
    const filteredDocs: Document[] = Array.from(currentDocs.values()).filter(
      (doc: any) => doc.metadata.source !== relativeFilePath,
    );

    const content = await fs.readFile(fullPath, "utf-8");
    const newDoc = new Document({
      pageContent: content,
      metadata: { source: relativeFilePath },
    });

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const splitNewDocs = await splitter.splitDocuments([newDoc]);

    const finalDocs = [...filteredDocs, ...splitNewDocs];
    const newVectorStore = await HNSWLib.fromDocuments(finalDocs, embeddings);

    await newVectorStore.save(indexPath);

    console.log(`[MITEY] ✨ Incremental update complete: ${relativeFilePath}`);
  } catch (error) {
    console.error("[MITEY] ❌ Incremental update failed. Rebuilding...", error);
    hasIndexedThisSession = false;
    await scanProject();
  }
}
