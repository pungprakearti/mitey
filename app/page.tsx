"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import ChatInterface, { type Message } from "@/components/ChatInterface";
import Sidebar from "@/components/Sidebar";
import ContextPanel, { type Snippet } from "@/components/ContextPanel";
import Footer from "@/components/Footer";
import { OLLAMA_CONFIG } from "@/lib/mitey/config";
import { AlertTriangle, Loader2 } from "lucide-react";

// ─── History helpers ──────────────────────────────────────────────────────────

async function loadHistory(type: "chat" | "snippets") {
  try {
    const res = await fetch(`/api/history?type=${type}`);
    const { data } = await res.json();
    return data ?? [];
  } catch {
    return [];
  }
}

async function saveHistory(type: "chat" | "snippets", data: any[]) {
  try {
    await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, data }),
    });
  } catch {}
}

async function clearHistory() {
  await fetch("/api/history", { method: "DELETE" });
}

// ─── Indexing overlay ─────────────────────────────────────────────────────────

function IndexingOverlay({ fileCount }: { fileCount: number | null }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950/90 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-6">
        {/* Animated logo */}
        <div className="relative">
          <div className="w-16 h-16 rounded-full border-2 border-emerald-500/20 flex items-center justify-center">
            <div className="w-4 h-4 rounded-full bg-emerald-500 shadow-[0_0_20px_#10b981]" />
          </div>
          {/* Spinning ring */}
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-emerald-500 animate-spin" />
        </div>

        <div className="text-center">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-emerald-500 mb-2">
            Indexing Project
          </p>
          <p className="text-[10px] font-mono text-zinc-500">
            {fileCount !== null
              ? `${fileCount} files scanned — building search index...`
              : "Scanning project files..."}
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-emerald-500/60 animate-pulse"
              style={{ animationDelay: `${i * 200}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Confirmation dialog ──────────────────────────────────────────────────────

function ClearConfirmDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center shrink-0">
            <AlertTriangle size={14} className="text-red-400" />
          </div>
          <h2 className="text-sm font-bold text-white uppercase tracking-widest">
            Clear All History
          </h2>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed mb-6">
          This will permanently delete all chat messages and saved snippets for
          this directory. This cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white text-xs font-bold uppercase tracking-widest transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 rounded-lg bg-red-900/60 hover:bg-red-800 border border-red-800/50 text-red-300 hover:text-white text-xs font-bold uppercase tracking-widest transition-all"
          >
            Clear Everything
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MiteyPage() {
  const [status, setStatus] = useState("Initializing Mitey...");
  const [isIndexing, setIsIndexing] = useState(true);
  const [indexFileCount, setIndexFileCount] = useState<number | null>(null);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedLines, setSelectedLines] = useState<
    { code: string; num: number }[]
  >([]);

  // Dual agent models — both default to local 14b
  const [generalModel, setGeneralModel] = useState<string>(
    OLLAMA_CONFIG.CHAT_MODEL,
  );
  const [codeEditModel, setCodeEditModel] = useState<string>(
    OLLAMA_CONFIG.CHAT_MODEL,
  );

  // Whether the DashScope API key is configured — fetched from server
  const [cloudConfigured, setCloudConfigured] = useState(false);

  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTab, setActiveTab] = useState<"viewer" | "snippets">("viewer");
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const chatSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snippetSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load history ────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([loadHistory("chat"), loadHistory("snippets")]).then(
      ([chatData, snippetData]) => {
        if (chatData.length > 0) setMessages(chatData);
        if (snippetData.length > 0) setSnippets(snippetData);
        setHistoryLoaded(true);
      },
    );
  }, []);

  // ── Check cloud config ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/cloud-status")
      .then((r) => r.json())
      .then((d) => setCloudConfigured(d.configured ?? false))
      .catch(() => setCloudConfigured(false));
  }, []);

  // ── Init scan — show overlay until complete ─────────────────────────────────
  useEffect(() => {
    setIsIndexing(true);
    fetch("/api/init")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setIndexFileCount(data.fileCount);
          setStatus(`Small, but Mighty! Scanned ${data.fileCount} files.`);
        } else {
          setStatus("Mitey is offline.");
        }
      })
      .catch(() => setStatus("Mitey is offline."))
      .finally(() => setIsIndexing(false));
  }, []);

  // ── Persist chat ────────────────────────────────────────────────────────────
  const handleMessagesChange = useCallback(
    (updated: Message[]) => {
      if (!historyLoaded) return;
      if (chatSaveTimer.current) clearTimeout(chatSaveTimer.current);
      chatSaveTimer.current = setTimeout(() => {
        saveHistory("chat", updated);
      }, 1000);
    },
    [historyLoaded],
  );

  // ── Persist snippets ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!historyLoaded) return;
    if (snippetSaveTimer.current) clearTimeout(snippetSaveTimer.current);
    snippetSaveTimer.current = setTimeout(() => {
      saveHistory("snippets", snippets);
    }, 500);
  }, [snippets, historyLoaded]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleToggleLine = (code: string, num: number) => {
    setSelectedLines((prev) => {
      const exists = prev.find((l) => l.num === num);
      if (exists) return prev.filter((l) => l.num !== num);
      return [...prev, { code, num }].sort((a, b) => a.num - b.num);
    });
  };

  const handleSetSelection = (lines: { code: string; num: number }[]) => {
    setSelectedLines([...lines].sort((a, b) => a.num - b.num));
  };

  const handleSnippetsExtracted = (newSnippets: Snippet[]) => {
    setSnippets((prev) => [...prev, ...newSnippets]);
    setActiveTab("snippets");
  };

  const handleDeleteSnippet = (id: string) => {
    setSnippets((prev) => prev.filter((s) => s.id !== id));
  };

  const handleClearConfirm = async () => {
    setShowClearDialog(false);
    await clearHistory();
    setMessages([]);
    setSnippets([]);
  };

  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden bg-zinc-950 text-zinc-300 font-sans">
      {/* Indexing overlay — blocks all interaction until index is ready */}
      {isIndexing && <IndexingOverlay fileCount={indexFileCount} />}

      {/* Clear confirmation dialog */}
      {showClearDialog && (
        <ClearConfirmDialog
          onConfirm={handleClearConfirm}
          onCancel={() => setShowClearDialog(false)}
        />
      )}

      {/* Header */}
      <div className="flex-none flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 z-10">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
          <span className="font-bold tracking-tighter text-white text-xl uppercase">
            Mitey
          </span>
        </div>
        <span className="text-[10px] font-mono font-bold text-emerald-500 bg-emerald-500/5 px-3 py-1.5 rounded-full border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
          {status}
        </span>
      </div>

      <div
        className="flex-1 grid gap-0 overflow-hidden"
        style={{ gridTemplateColumns: "20% 45% 35%" }}
      >
        <Sidebar
          onSelectFile={(file) => {
            setSelectedFile(file);
            setSelectedLines([]);
            setActiveTab("viewer");
          }}
          selectedFile={selectedFile}
          generalModel={generalModel}
          onSelectGeneralModel={setGeneralModel}
          codeEditModel={codeEditModel}
          onSelectCodeEditModel={setCodeEditModel}
          cloudConfigured={cloudConfigured}
        />

        <ContextPanel
          filePath={selectedFile}
          activeLines={selectedLines.map((l) => l.num)}
          onLineToggle={handleToggleLine}
          onSetSelection={handleSetSelection}
          onClearSelection={() => setSelectedLines([])}
          snippets={snippets}
          onDeleteSnippet={handleDeleteSnippet}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        <ChatInterface
          activeFile={selectedFile}
          generalModel={generalModel}
          codeEditModel={codeEditModel}
          highlightedCode={
            selectedLines.length > 0
              ? selectedLines.map((l) => `Line ${l.num}: ${l.code}`).join("\n")
              : null
          }
          initialMessages={messages}
          onMessagesChange={handleMessagesChange}
          onSnippetsExtracted={handleSnippetsExtracted}
          onClearAll={() => setShowClearDialog(true)}
        />
      </div>

      <Footer />
    </div>
  );
}
