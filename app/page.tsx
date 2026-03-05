"use client";

import { useEffect, useState } from "react";
import ChatInterface from "@/components/ChatInterface";
import Sidebar from "@/components/Sidebar";
import FileViewer from "@/components/FileViewer";
import Footer from "@/components/Footer";
import { OLLAMA_CONFIG } from "@/lib/mitey/config";

export default function MiteyPage() {
  const [status, setStatus] = useState("Initializing Mitey...");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(
    OLLAMA_CONFIG.CHAT_MODEL,
  );
  const [selectedLines, setSelectedLines] = useState<
    { code: string; num: number }[]
  >([]);

  useEffect(() => {
    fetch("/api/init")
      .then((res) => res.json())
      .then((data) => {
        if (data.success)
          setStatus(`Small, but Mighty! Scanned ${data.fileCount} files.`);
      })
      .catch(() => setStatus("Mitey is offline."));
  }, []);

  const handleToggleLine = (code: string, num: number) => {
    setSelectedLines((prev) => {
      const exists = prev.find((l) => l.num === num);
      if (exists) {
        return prev.filter((l) => l.num !== num);
      } else {
        return [...prev, { code, num }].sort((a, b) => a.num - b.num);
      }
    });
  };

  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden bg-zinc-950 text-zinc-300 font-sans">
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          height: 6px;
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #18181b;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #3f3f46;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #10b981;
        }
      `}</style>

      {/* Header - Restored Status Badge */}
      <div className="flex-none flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 z-10">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></div>
          <span className="font-bold tracking-tighter text-white text-xl uppercase">
            Mitey
          </span>
        </div>

        {/* The badge you wanted back! */}
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
          }}
          selectedFile={selectedFile}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
        />

        <FileViewer
          filePath={selectedFile}
          activeLines={selectedLines.map((l) => l.num)}
          onLineToggle={handleToggleLine}
          onClearSelection={() => setSelectedLines([])}
        />

        <ChatInterface
          activeFile={selectedFile}
          selectedModel={selectedModel}
          highlightedCode={
            selectedLines.length > 0
              ? selectedLines.map((l) => `Line ${l.num}: ${l.code}`).join("\n")
              : null
          }
        />
      </div>

      <Footer />
    </div>
  );
}
