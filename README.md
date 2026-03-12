# Mitey

> A local, privacy-first AI code assistant. Small, but mighty.

Mitey runs on your machine using [Ollama](https://ollama.com). It scans your codebase, builds a hybrid search index, and gives you a chat interface with direct file access — no data leaving your machine by default. Optionally, cloud models via [Groq](https://groq.com) can be enabled for faster, more powerful responses.

<img width="1917" height="947" alt="mitey-ui" src="https://github.com/user-attachments/assets/12bb59a5-6d09-4332-b294-8cc5c5a0d587" />

---

## How It Works

Mitey uses a **Hybrid Intelligence** pipeline to answer questions about your code accurately. Every chat message goes through several layers before the model ever sees it:

### 1. File Manifest Injection
On the first request, Mitey walks your project tree and builds a sorted manifest of every indexable file in the codebase. Files are filtered through four layers: a hardcoded blocklist of directories that are never source code (`node_modules`, `__pycache__`, `.git`, `.mitey_index`, etc.), your project's `.gitignore` if one exists, a 100KB file size cap, and a binary detection check. This manifest is injected into every prompt so the model always knows exactly which files exist — preventing it from inventing plausible-looking but fake file paths or imports.

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

### 4. Dual Agent Routing
Mitey automatically detects the intent of your message and routes it to the appropriate agent:

- **General Agent** — handles questions, explanations, navigation, and analysis. Uses whatever model you've selected for that slot.
- **Code Agent** — triggered automatically when your message contains an action word like `fix`, `refactor`, `update`, `add`, `remove`, `rewrite`, etc. Injects the full file content (not just a 12K slice) and uses the model selected for the Code Agent slot.

You can assign different models to each agent — for example, a faster local model on General and a powerful cloud model on Code. Both agents are displayed in the sidebar and support both local (Ollama) and cloud (Groq) models.

### 5. Streaming Response
The assembled context (manifest + active file + RAG chunks) is sent to the selected model. Responses are streamed back token-by-token. The sources used by the RAG pipeline are returned as an `X-Mitey-Sources` response header and displayed as file chips below each assistant message. Each response also shows a badge indicating which model and provider (Ollama or Groq) produced it.

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
                        ├─► src/components/Sidebar.tsx  — File browser + agent model selectors
                        ├─► src/components/ContextPanel.tsx — Syntax-highlighted file view with line selection
                        ├─► src/components/ChatInterface.tsx — Streaming chat UI with reasoning blocks
                        │
                        └─► API Routes
                                ├─► /api/init          — Triggers full project index on startup
                                ├─► /api/files         — Lists project files, triggers incremental reindex
                                ├─► /api/files/read    — Reads file content with 100KB safety guard
                                ├─► /api/models        — Fetches available Ollama + Groq models
                                ├─► /api/cloud-status  — Reports whether GROQ_API_KEY is configured
                                └─► /api/chat          — Main RAG + inference pipeline
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/mitey/config.ts` | Central config — `TARGET_DIR`, Ollama endpoints, model defaults, generation settings |
| `src/lib/mitey/scanner.ts` | Project indexer — language-agnostic file filtering, HNSWLib vector store + Orama BM25 index, exports `hybridSearch` |
| `src/lib/mitey/groqModels.ts` | Shared Groq model cache — fetches available models from Groq once per session, used by both the models route and chat route |
| `app/api/chat/route.ts` | Main pipeline — manifest injection, file lookup, hybrid search, prompt assembly, streaming, Groq fallback |
| `src/lib/ollamaCleanup.ts` | GPU cleanup — evicts models from VRAM on SIGINT/SIGTERM |
| `bin/cli.js` | CLI entry point — sets `MITEY_TARGET_DIR` and spawns the Next.js server |

---

## Prerequisites

### 1. Install Ollama
Visit [ollama.com](https://ollama.com) and follow the installation instructions for your OS.

### 2. Pull the Required Models

**LLM (reasoning + code generation):**
```bash
# Default — best quality/VRAM balance, requires ~8GB VRAM
ollama pull qwen2.5-coder:14b

# Lighter alternative for GPUs with 6GB or less
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
| `MITEY_MODEL` | `qwen2.5-coder:14b` | Override the default chat model without changing code. |
| `GROQ_API_KEY` | _(unset)_ | Optional. Add your Groq API key to unlock cloud models for both agents. |
| `PORT` | `3000` | Change the port the Next.js server listens on. |

Example with overrides:
```bash
MITEY_MODEL=qwen2.5-coder:7b PORT=4000 npx mitey
```

---

## Cloud Models (Optional)

By default, Mitey runs entirely locally. If you want access to faster, larger cloud models via [Groq](https://groq.com), you can enable them with a single environment variable. Groq offers a **free tier** with no credit card required — you just need an API key.

### Setup

**1. Get a Groq API key**

Sign up at [console.groq.com](https://console.groq.com). No credit card required for the free tier.

**2. Create a `.env.local` file**

In the root of the Mitey project directory (not your target project), create a `.env.local` file:

```
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Your `.env.local` should look exactly like this — one line, no quotes, no spaces around the `=`.

**3. Restart Mitey**

Stop and restart `npx mitey`. The sidebar will show **Cloud ready** in the Agents section and all available Groq models will appear in both agent dropdowns grouped under "Cloud (Groq)".

### Choosing a Cloud Model

Once enabled, Groq models appear in both the General Agent and Code Agent dropdowns alongside your local Ollama models. The recommended default is:

```
llama-4-scout-17b-16e-instruct ⭐
```

It is marked with a star in the dropdown. It offers the best balance of speed, context length (131K tokens), and code quality on Groq's free tier.

### Free Tier Limits

Groq's free tier is rate-limited by requests and tokens per minute. If a request hits the rate limit, Mitey will display an error message in the chat window telling you to try again in a moment or switch to a local model. You are never automatically billed for overages on the free tier.

### Fallback Behaviour

If a Groq request fails for a recoverable reason (network issue, content policy), Mitey automatically retries the same request using your local Ollama model and shows a **"Cloud failed · local fallback"** badge on the response so you always know which model actually answered.

---

## UI Features

**Sidebar**
- Full project file tree, sorted alphabetically
- **General Agent** selector — choose any local or cloud model for questions, explanations, and navigation
- **Code Agent** selector — choose any local or cloud model for edits, fixes, refactors, and rewrites. Triggered automatically when your message contains an action verb
- Cloud status indicator — shows "Cloud ready" and the number of available cloud models when Groq is configured, "Local only" otherwise
- File count badge

**File Viewer**
- Syntax-highlighted code view (VSCode Dark+ theme) with correct language detection per file type
- Click a line to select it; click-drag to select a range — all lines from the anchor to the cursor are highlighted continuously
- Selected lines are sent as focused context to the chat instead of the full file
- 100KB file size guard prevents browser freezes on large generated files

**Chat Interface**
- Streaming responses rendered with full Markdown + syntax highlighting
- `[THOUGHT]...[/THOUGHT]` reasoning blocks displayed above each response
- RAG source chips shown below every assistant message — see exactly which files informed the answer
- Model badge on every response showing which model and provider (Ollama or Groq) was used, with a fallback warning if cloud failed
- Structured error messages displayed inline when a model is not found, rate limits are hit, or Ollama is offline
- Conversation history sanitized before each API call (reasoning blocks stripped from past messages)
- Cancel streaming at any time via the stop button or `Escape` key
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

Mitey's file scanner is language-agnostic — it indexes any text file under 100KB that isn't excluded by your `.gitignore` or the built-in directory blocklist. This means it works equally well on Python, Rust, Go, Ruby, and any other codebase without configuration.

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
| Cloud LLM | Groq (optional) |
| LLM SDK | Vercel AI SDK + `@ai-sdk/openai` + `@ai-sdk/groq` |
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