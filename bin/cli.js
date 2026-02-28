#!/usr/bin/env node

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

// 1. Get the current working directory (where Andrew is standing)
const targetProject = process.cwd();

// 2. Get the directory where the Mitey app code lives
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");

console.log(`\n🚀 Mitey is waking up...`);
console.log(`📂 Analyzing project at: ${targetProject}\n`);

// 3. Start the Next.js app
// We pass the target directory as an environment variable
const miteyProcess = spawn("npm", ["run", "dev"], {
  cwd: appDir,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    MITEY_TARGET_DIR: targetProject,
    PORT: "3000", // You can change the port if 3000 is busy
  },
});

miteyProcess.on("close", (code) => {
  console.log(`\nMitey has gone back to sleep. (Exit code: ${code})`);
  process.exit(code);
});
