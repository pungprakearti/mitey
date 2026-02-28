import fs from "fs/promises";
import path from "path";

export async function getFileContent(fileName: string) {
  try {
    const filePath = path.join(process.cwd(), fileName);
    const content = await fs.readFile(filePath, "utf-8");
    return content;
  } catch (error) {
    return `Error reading file: ${fileName}`;
  }
}
