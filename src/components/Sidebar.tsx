"use client";

import { useEffect, useState } from "react";
import { FileCode, Loader2, FolderOpen, Cpu } from "lucide-react";

interface SidebarProps {
  onSelectFile: (path: string) => void;
  selectedFile: string | null;
  selectedModel: string;
  onSelectModel: (model: string) => void;
}

export default function Sidebar({
  onSelectFile,
  selectedFile,
  selectedModel,
  onSelectModel,
}: SidebarProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [filesRes, modelsRes] = await Promise.all([
          fetch("/api/files"),
          fetch("/api/models"),
        ]);

        const filesData = await filesRes.json();
        const modelsData = await modelsRes.json();

        if (filesData.files) setFiles(filesData.files.sort());

        if (modelsData.models && modelsData.models.length > 0) {
          setModels(modelsData.models);

          // Fallback logic: if current selection is invalid, pick the first one
          if (!modelsData.models.includes(selectedModel)) {
            onSelectModel(modelsData.models[0]);
          }
        }
      } catch (err) {
        console.error("Failed to load sidebar data", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <div className="flex flex-col h-full border-r border-zinc-800 bg-zinc-900/20 overflow-hidden">
      {/* Model Selector Header */}
      <div className="p-4 border-b border-zinc-800/50 bg-zinc-900/40">
        <div className="flex items-center gap-2 mb-3">
          <Cpu size={14} className="text-emerald-500" />
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">
            Active Agent
          </p>
        </div>
        <select
          value={selectedModel}
          onChange={(e) => onSelectModel(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-emerald-400 p-2 rounded outline-none focus:ring-1 focus:ring-emerald-500/50"
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Sidebar Header */}
      <div className="p-4 border-b border-zinc-800/50 bg-zinc-900/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen size={14} className="text-emerald-500" />
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">
            Project Files
          </p>
        </div>
        <span className="text-[9px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded border border-zinc-700 font-mono">
          {files.length}
        </span>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 opacity-50">
            <Loader2 size={16} className="animate-spin text-emerald-500" />
            <p className="text-[10px] font-mono uppercase tracking-widest">
              Indexing...
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {files.map((filePath) => {
              const isActive = selectedFile === filePath;

              return (
                <button
                  key={filePath}
                  onClick={() => onSelectFile(filePath)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-all group text-left border ${
                    isActive
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-[inset_0_0_10px_rgba(16,185,129,0.05)]"
                      : "border-transparent hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <FileCode
                    size={14}
                    className={`shrink-0 transition-colors ${
                      isActive
                        ? "text-emerald-500"
                        : "text-zinc-600 group-hover:text-zinc-400"
                    }`}
                  />
                  <span className="text-xs font-mono truncate">{filePath}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
