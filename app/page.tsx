"use client";

import { useEffect, useState } from "react";
import ChatInterface from "@/components/ChatInterface";
import Sidebar from "@/components/Sidebar";
import FileViewer from "@/components/FileViewer";

export default function MiteyPage() {
  const [status, setStatus] = useState("Initializing Mitey...");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Now storing an array of selected lines
  const [selectedLines, setSelectedLines] = useState<
    { code: string; num: number }[]
  >([]);

  useEffect(() => {
    fetch("/api/init")
      .then((res) => res.json())
      .then((data) => {
        if (data.success)
          setStatus(
            `Small, but Mighty! Ready to scan ${data.fileCount} files.`,
          );
      })
      .catch(() => setStatus("Mitey is offline."));
  }, []);

  const handleToggleLine = (code: string, num: number) => {
    setSelectedLines((prev) => {
      const exists = prev.find((l) => l.num === num);
      if (exists) {
        // Deselect: Remove the line
        return prev.filter((l) => l.num !== num);
      } else {
        // Select: Add and sort by line number
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

      <div className="flex-none flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 z-10">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></div>
          <span className="font-bold tracking-tighter text-white text-xl uppercase">
            Mitey CLI
          </span>
        </div>
        <span className="text-xs font-mono text-zinc-500 bg-zinc-900 px-3 py-1 rounded-full border border-zinc-800">
          {status}
        </span>
      </div>

      <div
        className="flex-1 grid gap-0 overflow-hidden"
        style={{ gridTemplateColumns: "20% 50% 30%" }}
      >
        <Sidebar
          onSelectFile={(file) => {
            setSelectedFile(file);
            setSelectedLines([]); // Clear memory when file changes
          }}
          selectedFile={selectedFile}
        />

        <FileViewer
          filePath={selectedFile}
          activeLines={selectedLines.map((l) => l.num)}
          onLineToggle={handleToggleLine}
          onClearSelection={() => setSelectedLines([])} // Add this prop
        />

        <ChatInterface
          activeFile={selectedFile}
          highlightedCode={
            selectedLines.length > 0
              ? selectedLines.map((l) => `Line ${l.num}: ${l.code}`).join("\n")
              : null
          }
        />
      </div>
    </div>
  );
}
