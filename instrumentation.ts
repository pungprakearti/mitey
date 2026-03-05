export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 1. Existing Cleanup Logic
    const { registerCleanup } = await import("./src/lib/ollamaCleanup");
    registerCleanup();

    // 2. File Watcher Logic
    // We import the scanner functions and chokidar
    const { updateFileIndex } = await import("./src/lib/mitey/scanner");
    const chokidar = await import("chokidar");
    const path = await import("path");

    const targetDir = process.cwd();
    const supportedExtensions = [".js", ".jsx", ".ts", ".tsx", ".json", ".md"];

    // Initialize watcher
    const watcher = chokidar.watch(targetDir, {
      ignored: [
        /(^|[\/\\])\../, // ignore dotfiles
        "**/node_modules/**",
        "**/.next/**",
        "**/.mitey_index/**",
      ],
      persistent: true,
      ignoreInitial: true, // Don't trigger on every file when starting up
    });

    console.log("[MITEY] 🔍 File watcher started. Watching for changes...");

    watcher.on("change", async (filePath) => {
      const ext = path.extname(filePath);
      if (supportedExtensions.includes(ext)) {
        const relativePath = path.relative(targetDir, filePath);
        console.log(`[MITEY] 📝 File save detected: ${relativePath}`);

        try {
          await updateFileIndex(relativePath);
        } catch (error) {
          console.error(
            `[MITEY] ❌ Auto-reindex failed for ${relativePath}:`,
            error,
          );
        }
      }
    });
  }
}
