import { execSync } from "child_process";

/**
 * Mitey GPU Cleanup Utility
 * Ensures models are evicted from the GPU on exit.
 */
export const registerCleanup = () => {
  let isCleaningUp = false;

  const unloadModels = () => {
    if (isCleaningUp) return;
    isCleaningUp = true;

    process.stdout.write("\n--- Mitey: Clearing GPU Memory ---\n");

    try {
      // Get currently loaded models (sync so the process doesn't slip away)
      const psOutput = execSync("curl -s http://localhost:11434/api/ps", {
        encoding: "utf-8",
      });
      const psData = JSON.parse(psOutput);

      if (psData.models && psData.models.length > 0) {
        psData.models.forEach((modelObj: { name: string }) => {
          process.stdout.write(`Evicting ${modelObj.name}...\n`);

          // Force unload with a 2s timeout per model
          execSync(
            `curl -s --max-time 2 -X POST http://localhost:11434/api/generate -d '{"model": "${modelObj.name}", "keep_alive": 0}'`,
            { stdio: "ignore" },
          );
        });
        process.stdout.write("VRAM released!\n");
      }
    } catch {
      // Silent catch — don't produce messy exit logs if Ollama isn't running
    } finally {
      // Replace process.kill(SIGKILL) with process.exit(0).
      // SIGKILL is an immediate hard kill that bypasses Node's I/O flush,
      // which corrupts any in-progress streaming response. process.exit(0)
      // allows the event loop to drain open handles cleanly before terminating,
      // so active streams can close gracefully instead of breaking the client.
      process.exit(0);
    }
  };

  // Register 'once' to prevent double-triggering on repeated signals
  process.once("SIGINT", unloadModels);
  process.once("SIGTERM", unloadModels);
};
