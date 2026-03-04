import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OllamaEmbeddings } from "@langchain/ollama";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { Document } from "@langchain/core/documents";
import path from "path";
import fs from "fs/promises";

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
  const targetDir = process.cwd();
  const indexPath = path.join(targetDir, ".mitey_index");
  const supportedExtensions = [".js", ".jsx", ".ts", ".tsx", ".json", ".md"];
  const MAX_INDEX_SIZE = 500 * 1024; // 500KB limit for AI indexing

  console.log("[MITEY] Reading project files...");
  const allFilePaths = await getFiles(targetDir, supportedExtensions);

  const rawDocs: Document[] = await Promise.all(
    allFilePaths.map(async (filePath) => {
      const stats = await fs.stat(filePath);

      // Safety: Don't read content if it's a massive lockfile or minified bundle
      if (stats.size > MAX_INDEX_SIZE) {
        return new Document({
          pageContent: `File too large to index (${Math.round(stats.size / 1024)}KB).`,
          metadata: { source: filePath, tooLarge: true },
        });
      }

      const content = await fs.readFile(filePath, "utf-8");
      return new Document({
        pageContent: content,
        metadata: { source: filePath },
      });
    }),
  );

  const uniqueFiles = allFilePaths
    .map((p) => path.relative(targetDir, p))
    .sort();

  try {
    await fs.access(indexPath);
    return uniqueFiles;
  } catch {
    console.log("[MITEY] No index found. Starting embedding process...");
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const splitDocs = await splitter.splitDocuments(rawDocs);

  const embeddings = new OllamaEmbeddings({
    model: "nomic-embed-text",
    baseUrl: "http://localhost:11434",
  });

  const vectorStore = await HNSWLib.fromDocuments(splitDocs, embeddings);
  await vectorStore.save(indexPath);

  return uniqueFiles;
}
