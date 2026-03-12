"use client";

import { useEffect, useState } from "react";
import {
  FileCode,
  Loader2,
  FolderOpen,
  Cpu,
  Cloud,
  CloudOff,
} from "lucide-react";

interface SidebarProps {
  onSelectFile: (path: string) => void;
  selectedFile: string | null;
  generalModel: string;
  onSelectGeneralModel: (model: string) => void;
  codeEditModel: string;
  onSelectCodeEditModel: (model: string) => void;
  cloudConfigured: boolean;
}

export default function Sidebar({
  onSelectFile,
  selectedFile,
  generalModel,
  onSelectGeneralModel,
  codeEditModel,
  onSelectCodeEditModel,
  cloudConfigured,
}: SidebarProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [cloudModels, setCloudModels] = useState<string[]>([]);
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

        const locals: string[] = modelsData.localModels ?? [];
        const clouds: string[] = modelsData.cloudModels ?? [];

        setLocalModels(locals);
        setCloudModels(clouds);

        // Set sensible defaults if current selection is no longer valid
        const allModels = [...locals, ...clouds];
        if (allModels.length > 0) {
          if (!allModels.includes(generalModel)) {
            onSelectGeneralModel(locals[0] ?? allModels[0]);
          }
          if (!allModels.includes(codeEditModel)) {
            onSelectCodeEditModel(locals[0] ?? allModels[0]);
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

  // Short display label for Groq model IDs.
  // "meta-llama/llama-4-scout-17b-16e-instruct" → "llama-4-scout-17b-16e-instruct"
  const PREFERRED_CLOUD_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

  const cloudLabel = (id: string) => {
    const short = id.includes("/") ? id.split("/").pop()! : id;
    return id === PREFERRED_CLOUD_MODEL ? `${short} ⭐` : short;
  };

  return (
    <div className="flex flex-col h-full border-r border-zinc-800 bg-zinc-900/20 overflow-hidden">
      {/* ── Cloud status — shared indicator for both agents ────────────────── */}
      <div className="px-4 pt-4 pb-3 border-b border-zinc-800/50 bg-zinc-900/40">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">
            Agents
          </p>
          {cloudConfigured ? (
            <div className="flex items-center gap-1.5">
              <Cloud size={10} className="text-emerald-500" />
              <span className="text-[9px] text-emerald-500 font-mono">
                {cloudModels.length > 0
                  ? `${cloudModels.length} cloud models`
                  : "Cloud ready"}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <CloudOff size={10} className="text-zinc-600" />
              <span className="text-[9px] text-zinc-600 font-mono">
                Local only
              </span>
            </div>
          )}
        </div>
        {!cloudConfigured && (
          <p className="text-[9px] text-zinc-700 mt-1.5 font-mono leading-relaxed">
            Add GROQ_API_KEY to .env.local to unlock cloud models for both
            agents
          </p>
        )}
      </div>

      {/* ── General Agent ──────────────────────────────────────────────────── */}
      <div className="p-4 border-b border-zinc-800/50 bg-zinc-900/40">
        <div className="flex items-center gap-2 mb-2">
          <Cpu size={12} className="text-emerald-500" />
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">
            General Agent
          </p>
        </div>
        <select
          value={generalModel}
          onChange={(e) => onSelectGeneralModel(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-emerald-400 p-2 rounded outline-none focus:ring-1 focus:ring-emerald-500/50"
        >
          {localModels.length > 0 && (
            <optgroup label="Local (Ollama)">
              {localModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </optgroup>
          )}
          {cloudModels.length > 0 && (
            <optgroup label="Cloud (Groq)">
              {cloudModels.map((m) => (
                <option key={m} value={m}>
                  ☁ {cloudLabel(m)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <p className="text-[9px] text-zinc-600 mt-1.5 font-mono">
          Questions · Explanation · Navigation
        </p>
      </div>

      {/* ── Code Agent ─────────────────────────────────────────────────────── */}
      <div className="p-4 border-b border-zinc-800/50 bg-zinc-900/40">
        <div className="flex items-center gap-2 mb-2">
          <Cpu size={12} className="text-violet-400" />
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">
            Code Agent
          </p>
        </div>
        <select
          value={codeEditModel}
          onChange={(e) => onSelectCodeEditModel(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-violet-400 p-2 rounded outline-none focus:ring-1 focus:ring-violet-500/50"
        >
          {localModels.length > 0 && (
            <optgroup label="Local (Ollama)">
              {localModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </optgroup>
          )}
          {cloudModels.length > 0 && (
            <optgroup label="Cloud (Groq)">
              {cloudModels.map((m) => (
                <option key={m} value={m}>
                  ☁ {cloudLabel(m)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <p className="text-[9px] text-zinc-600 mt-1.5 font-mono">
          Edits · Fixes · Refactors · Rewrites
        </p>
      </div>

      {/* ── Project Files header ────────────────────────────────────────────── */}
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

      {/* ── File List ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 opacity-50">
            <Loader2 size={16} className="animate-spin text-emerald-500" />
            <p className="text-[10px] font-mono uppercase tracking-widest">
              Loading...
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
