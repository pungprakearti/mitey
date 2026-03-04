import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "hnswlib-node",
    "langchain",
    "@langchain/community",
    "@langchain/core",
    "@langchain/ollama",
    "@langchain/textsplitters",
  ],
};

export default nextConfig;
