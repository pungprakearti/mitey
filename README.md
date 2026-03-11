# Mitey

> A local, privacy-first AI code assistant. Small, but mighty.

Mitey runs entirely on your machine using [Ollama](https://ollama.com). It scans your codebase, builds a hybrid search index, and gives you a chat interface with direct file access — no cloud, no API keys, no data leaving your machine.

<img width="1917" height="947" alt="mitey-ui" src="https://github.com/user-attachments/assets/12bb59a5-6d09-4332-b294-8cc5c5a0d587" />

---

## How It Works

Mitey uses a **Hybrid Intelligence** pipeline to answer questions about your code accurately. Every chat message goes through several layers before the model ever sees it:

### 1. File Manifest Injection
On the first request, Mitey walks your project tree (respecting `node_modules` and dotfile exclusions) and builds a sorted manifest of every file in the codebase. This manifest is injected into every prompt so the model always knows exactly which files exist — preventing it from inventing plausible-looking but fake file paths or imports.

The manifest is cached in memory after the first build so subsequent requests pay no disk I/O cost.

### 2. Active File Context
If you have a file selected in the sidebar, its full content (up to 12,000 characters) is injected directly into the prompt. If you've highlighted specific lines, only those lines are sent. This gives the model precise, grounded context for the code you're actually looking at.

If your message mentions a filename (e.g. `scanner.ts`), Mitey will automatically locate and read that file even if it isn't currently selected.

### 3. Hybrid RAG Search
This is the core retrieval system. When Mitey starts, it indexes your entire codebase into two parallel stores:

**Vector Store (HNSWLib + nomic-embed-text)**
Your code is split into 600-token chunks with 100-token overlap and converted into high-dimensional vectors using the `nomic-embed-text` embedding model. These vectors capture semantic meaning — so a question like "where is authentication handled?" will find the right code even if it never uses the word "authentication".

**Keyword Store (Orama BM25)**
The same chunks are simultaneously indexed into an Orama full-text search engine using the BM25 algorithm. Unlike vector search, BM25 scores by exact term frequency — so queries containing specific function names like `HNSWLib.load`, `streamText`, or `hybridSearch` will always surface the exact lines where those terms appear.

**Reciprocal Rank Fusion (RRF)**
Both searches run in parallel on every query. Their ranked result lists are merged using RRF — each chunk gets a score of `1 / (rank + 61)` from each list, and the scores are summed. Chunks that appear highly in both lists float to the top. The top 8 merged results are injected into the prompt as background context.

This means Mitey handles both conceptual questions ("how does the scanner work?") and exact lookups ("show me the hybridSearch call") with equal precision.

Both indexes are cached in memory after the first load — the vector store (`HNSWLib`) and BM25 index (`oramaDb`) are only read from disk once per server session.

### 4. Streaming Response
The assembled context (manifest + active file + RAG chunks) is sent to the selected Ollama model via the Vercel AI SDK's OpenAI-compatible adapter. Responses are streamed back token-by-token. The sources used by the RAG pipeline are returned as an `X-Mitey-Sources` response header and displayed as file chips below each assistant message.

---

## Architecture

```
npx mitey
    │
    └─► bin/cli.js
            Sets MITEY_TARGET_DIR env var to cwd
            Spawns Next.js dev server from the Mitey app directory
                │
                └─► Next.js App (localhost:3000)
                        │
                        ├─► app/page.tsx               — Root layout, state management
                        ├─► src/components/Sidebar.tsx  — File browser + model selector
                        ├─► src/components/FileViewer.tsx — Syntax-highlighted file view with line selection
                        ├─► src/components/ChatInterface.tsx — Streaming chat UI with reasoning blocks
                        │
                        └─► API Routes
                                ├─► /api/init          — Triggers full project index on startup
                                ├─► /api/files         — Lists project files, triggers incremental reindex
                                ├─► /api/files/read    — Reads file content with 100KB safety guard
                                ├─► /api/models        — Fetches available Ollama models
                                └─► /api/chat          — Main RAG + inference pipeline
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/mitey/config.ts` | Central config — `TARGET_DIR`, Ollama endpoints, model defaults, generation settings |
| `src/lib/mitey/scanner.ts` | Project indexer — builds HNSWLib vector store + Orama BM25 index, exports `hybridSearch` |
| `app/api/chat/route.ts` | Main pipeline — manifest injection, file lookup, hybrid search, prompt assembly, streaming |
| `src/lib/ollamaCleanup.ts` | GPU cleanup — evicts models from VRAM on SIGINT/SIGTERM |
| `bin/cli.js` | CLI entry point — sets `MITEY_TARGET_DIR` and spawns the Next.js server |

---

## Prerequisites

### 1. Install Ollama
Visit [ollama.com](https://ollama.com) and follow the installation instructions for your OS.

### 2. Pull the Required Models

**LLM (reasoning + code generation):**
```bash
# Recommended — best quality/VRAM balance for 8GB GPUs
ollama pull qwen2.5-coder:14b

# Lighter alternative for 6GB or less
ollama pull qwen2.5-coder:7b
```

**Embeddings (semantic search):**
```bash
ollama pull nomic-embed-text
```

> `nomic-embed-text` is required regardless of which LLM you choose. It powers the vector half of the hybrid search index.

---

## Installation

```bash
git clone https://github.com/pungprakearti/mitey
cd mitey
npm install
npm link   # enables the `mitey` command globally
```

---

## Usage

Navigate to any project directory and run:

```bash
npx mitey
```

Mitey will:
1. Set that directory as `MITEY_TARGET_DIR`
2. Start the Next.js server at `http://localhost:3000`
3. Scan and index your project (vector + BM25) on first load
4. Open ready to chat

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MITEY_TARGET_DIR` | `process.cwd()` | Set automatically by the CLI. Override to point at a specific directory. |
| `MITEY_MODEL` | `qwen2.5-coder:7b` | Override the default chat model without changing code. |
| `PORT` | `3000` | Change the port the Next.js server listens on. |

Example with overrides:
```bash
MITEY_MODEL=qwen2.5-coder:14b PORT=4000 npx mitey
```

---

## UI Features

**Sidebar**
- Full project file tree, sorted alphabetically
- Live model selector — switch between any locally available Ollama model mid-session
- File count badge

**File Viewer**
- Syntax-highlighted code view (VSCode Dark+ theme)
- Click or click-drag to select individual lines
- Selected lines are sent as focused context to the chat instead of the full file
- 100KB file size guard prevents browser freezes on large generated files (e.g. `package-lock.json`)

**Chat Interface**
- Streaming responses rendered with full Markdown + syntax highlighting
- `[THOUGHT]...[/THOUGHT]` reasoning blocks displayed in a collapsible panel above each response
- RAG source chips shown below every assistant message — see exactly which files informed the answer
- Conversation history sanitized before each API call (reasoning blocks stripped from past messages)
- Reset button clears conversation without page reload

---

## The Index

On first run, Mitey creates a `.mitey_index/` directory in your project root containing:

```
.mitey_index/
    ├── hnswlib.index     — Vector similarity index (HNSWLib)
    ├── docstore.json     — Chunk content + metadata
    └── bm25.json         — Orama keyword search index
```

The index is rebuilt fresh on every new session (stale cache is deleted on startup). Individual files can be reindexed incrementally via `POST /api/files` without a full rebuild.

Add `.mitey_index` to your `.gitignore` — it's local to your machine and regenerates automatically.

---

## GPU Memory

Mitey is designed for local GPU inference. The `ollamaCleanup.ts` utility registers `SIGINT`/`SIGTERM` handlers that explicitly evict all loaded models from VRAM when you stop the server (`Ctrl+C`), using Ollama's `keep_alive: 0` API. This prevents models from lingering in GPU memory after the session ends.

If you have limited VRAM, note that both the embedding model (`nomic-embed-text`) and the chat model are loaded simultaneously during indexing. They do not need to be loaded at the same time during chat — `nomic-embed-text` is only active during the vector search step.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Local LLM | Ollama |
| LLM SDK | Vercel AI SDK + `@ai-sdk/openai` adapter |
| Vector Store | HNSWLib via `@langchain/community` |
| Embeddings | `nomic-embed-text` via `@langchain/ollama` |
| Keyword Search | Orama (BM25 full-text, in-process) |
| Text Splitting | LangChain `RecursiveCharacterTextSplitter` |
| Syntax Highlighting | `react-syntax-highlighter` (VSCode Dark+) |
| Markdown Rendering | `react-markdown` + `remark-gfm` |
| Styling | Tailwind CSS |

---

## About

Created by [Andrew Pungprakearti](https://www.biscuitsinthebasket.com)
- [GitHub](https://github.com/pungprakearti)
- [LinkedIn](https://www.linkedin.com/in/andrewpungprakearti/)