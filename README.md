# Mitey

Mitey is a small but mighty local AI development assistant. It scans your local codebase, creates semantic embeddings for deep searching, and provides a web interface to chat with your code using Ollama.

## 🛠 Prerequisites

Before running Mitey, you need to have Ollama installed and the necessary models pulled.

1. Download Ollama: Visit [ollama.com](https://www.ollama.com) and follow the installation instructions for your OS.

2. Pull the Models: Open your terminal and run the following commands:

3. The LLM (Logic): 
```ollama pull qwen2.5-coder:7b```

4. The Embeddings (Search):
```ollama pull nomic-embed-text```

## 📦 Installation

To set up Mitey locally for development and global use:

### Clone the Repository:
```Bash
git clone https://github.com/pungprakearti/mitey

cd mitey
```

### Install Dependencies:
```Bash
npm install
```
### Link for Global Access:
To use the mitey command from any directory on your system:
```Bash
npm link
```

## 🚀 Usage
Opening Mitey in any Project

Mitey is designed to be portable. To analyze a specific codebase, navigate to that project's directory and run:
```Bash
npx mitey
```
This will launch the Mitey interface, automatically setting the target directory to your current location.

## 🧠 How it Works

Mitey uses a "Hybrid Intelligence" approach to help you navigate your code:
1. Scanning & Embeddings

When Mitey starts, it performs a deep scan of your project (respecting .gitignore rules).

    Vectorization: Using the nomic-embed-text model, it converts your code blocks into mathematical vectors.

    Local Index: It saves these embeddings into a local .mitey_index folder within your project. This allows for lightning-fast semantic searches (e.g., "Where is the auth logic?") without re-reading every file.

2. Context-Aware Chat

The Mitey chat interface isn't just a generic AI; it has "eyes" on your files.

    Automatic Retrieval: When you mention a filename or ask a specific question, Mitey pulls the real-time content of those files directly from your disk.

    Zero-Hallucination: By providing the actual source code as context to the qwen2.5-coder model, Mitey ensures that explanations and refactors are based on your actual logic, not guesses.

## ⌨️ Tech Stack

    Framework: Next.js (App Router)

    AI Orchestration: LangChain & Vercel AI SDK

    Local LLM: Ollama

    Vector Store: HNSWLib

    Styling: Tailwind CSS