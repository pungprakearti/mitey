import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import fs from "fs/promises";
import path from "path";
import { TARGET_DIR, miteyConfig } from "./config";

export async function chatWithContext(
  userQuery: string,
  history: any[],
  allFileNames: string[],
) {
  const { embeddings, model, dbPath } = miteyConfig;

  // Load the vector store created by the scanner
  const savedStore = await HNSWLib.load(dbPath, embeddings);
  let context = "";

  // Hybrid Search Logic: Check if the user mentioned a specific filename
  const mentionedFile = allFileNames.find((name) =>
    userQuery.toLowerCase().includes(path.basename(name).toLowerCase()),
  );

  if (mentionedFile) {
    const fullPath = path.join(TARGET_DIR, mentionedFile);
    const fullContent = await fs.readFile(fullPath, "utf-8");
    context = `[File: ${mentionedFile}]\n${fullContent}`;
  } else {
    const searchResults = await savedStore.similaritySearch(userQuery, 6);
    context = searchResults
      .map(
        (res) =>
          `[File: ${res.metadata.source.replace(TARGET_DIR, "")}]\n${res.pageContent}`,
      )
      .join("\n---\n");
  }

  const systemMessage = [
    "system",
    `Your name is Mitey. You are small, but mighty! Act as a highly skilled assistant. 
     Project files: ${allFileNames.join(", ")}.
     Use the context to answer. State which file you are referring to.`,
  ];

  const currentMessage = [
    "user",
    `Context snippets:\n${context}\n\nQuestion: ${userQuery}`,
  ];

  const fullPrompt = [systemMessage, ...history, currentMessage];
  const response = await model.invoke(fullPrompt);

  return response.content;
}
