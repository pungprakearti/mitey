import fs from "fs/promises";
import path from "path";
import { TARGET_DIR } from "./config";

// Helper to recursively get files
async function getFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((res) => {
      const resPath = path.resolve(dir, res.name);

      // Standard ignore list
      if (
        res.name === "node_modules" ||
        res.name === ".git" ||
        res.name === ".mitey_index" ||
        res.name === ".next" ||
        res.name === "dist"
      ) {
        return [];
      }

      return res.isDirectory() ? getFiles(resPath) : resPath;
    }),
  );
  return Array.prototype.concat(...files);
}

export async function scanProject() {
  console.log(`[MITEY] 🔍 Scanning: ${TARGET_DIR}`);

  const allFilePaths = await getFiles(TARGET_DIR);
  const validExtensions = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".css",
    ".json",
    ".md",
  ];

  const sourceFiles: string[] = [];

  for (const filePath of allFilePaths) {
    if (validExtensions.includes(path.extname(filePath))) {
      // Create the relative path from TARGET_DIR (e.g., "src/apiChat.mjs")
      const relativePath = path.relative(TARGET_DIR, filePath);
      sourceFiles.push(relativePath);
    }
  }

  console.log(`[MITEY] 📝 Located ${sourceFiles.length} files.`);

  // We return just the string array of paths for the route to use
  return sourceFiles;
}
