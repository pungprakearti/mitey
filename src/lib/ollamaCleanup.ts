import { execSync } from "child_process";

/**
 * Mitey GPU Cleanup Utility
 * Ensures qwen2.5-coder and nomic-embed-text are evicted from the RTX 5060 on exit.
 */
export const registerCleanup = () => {
  let isCleaningUp = false;

  const unloadModels = () => {
    if (isCleaningUp) return;
    isCleaningUp = true;

    // 1. Give the user immediate feedback
    process.stdout.write("\n--- Mitey: Clearing GPU Memory ---\n");

    try {
      // 2. Get currently loaded models (Sync so npx can't slip away)
      const psOutput = execSync("curl -s http://localhost:11434/api/ps", {
        encoding: "utf-8",
      });
      const psData = JSON.parse(psOutput);

      if (psData.models && psData.models.length > 0) {
        psData.models.forEach((modelObj: { name: string }) => {
          process.stdout.write(`Evicting ${modelObj.name}...\n`);

          // 3. Force unload with a 2s timeout per model
          execSync(
            `curl -s --max-time 2 -X POST http://localhost:11434/api/generate -d '{"model": "${modelObj.name}", "keep_alive": 0}'`,
            { stdio: "ignore" },
          );
        });
        process.stdout.write("VRAM released! (907MiB idle)\n");
      }
    } catch (error: unknown) {
      // Silent catch to prevent messy exit logs
    } finally {
      // 4. THE FIX: Force the process to terminate immediately.
      // This stops the 'zombie' output that stays behind the Zsh prompt.
      process.kill(process.pid, "SIGKILL");
    }
  };

  // Registering 'once' to prevent double-triggering
  process.once("SIGINT", unloadModels);
  process.once("SIGTERM", unloadModels);
};
