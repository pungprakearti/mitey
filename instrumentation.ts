export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // If your file is at /src/lib/ollamaCleanup.ts
    // and instrumentation is at /instrumentation.ts
    const { registerCleanup } = await import("./src/lib/ollamaCleanup");

    // OR if they are both in the root:
    // const { registerCleanup } = await import('./lib/ollamaCleanup');

    registerCleanup();
  }
}
