"use client";

import { useState, useEffect, useRef } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { FileCode, BookOpen, Copy, Check, X, Loader2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Snippet {
  id: string;
  description: string;
  language: string;
  code: string;
  timestamp: number;
}

interface FileViewerProps {
  filePath: string | null;
  activeLines: number[];
  onLineToggle: (code: string, num: number) => void;
  onSetSelection: (lines: { code: string; num: number }[]) => void;
  onClearSelection: () => void;
}

interface ContextPanelProps extends FileViewerProps {
  snippets: Snippet[];
  onDeleteSnippet: (id: string) => void;
  activeTab?: "viewer" | "snippets";
  onTabChange?: (tab: "viewer" | "snippets") => void;
}

// ─── Snippet copy button ──────────────────────────────────────────────────────

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      title="Copy code"
      className={`p-1.5 rounded-md border transition-all
        ${
          copied
            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
            : "bg-zinc-800/80 border-zinc-700/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
        }`}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

// ─── Snippet Log tab ──────────────────────────────────────────────────────────

function SnippetLog({
  snippets,
  onDelete,
}: {
  snippets: Snippet[];
  onDelete: (id: string) => void;
}) {
  if (snippets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-30">
        <div className="border-2 border-dashed border-zinc-800 p-8 rounded-xl text-center">
          <BookOpen size={20} className="text-zinc-600 mx-auto mb-3" />
          <p className="text-xs font-mono italic text-zinc-500">
            Code snippets from Mitey will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
      {snippets.map((snippet) => (
        <div
          key={snippet.id}
          className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl overflow-hidden"
        >
          {/* Snippet header */}
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-zinc-800/60">
            <p className="text-[11px] text-zinc-400 leading-relaxed flex-1">
              {snippet.description}
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              <CopyButton code={snippet.code} />
              <button
                onClick={() => onDelete(snippet.id)}
                title="Remove snippet"
                className="p-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/80 text-zinc-500 hover:text-red-400 hover:border-red-900/50 transition-all"
              >
                <X size={11} />
              </button>
            </div>
          </div>

          {/* Code block */}
          <SyntaxHighlighter
            style={vscDarkPlus as any}
            language={snippet.language}
            PreTag="div"
            customStyle={{
              margin: 0,
              padding: "12px 16px",
              fontSize: "11px",
              lineHeight: "1.6",
              backgroundColor: "transparent",
            }}
          >
            {snippet.code}
          </SyntaxHighlighter>

          {/* Timestamp */}
          <div className="px-4 py-1.5 border-t border-zinc-800/40">
            <span className="text-[9px] font-mono text-zinc-700">
              {new Date(snippet.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── File Viewer tab ──────────────────────────────────────────────────────────

function FileViewerTab({
  filePath,
  activeLines,
  onLineToggle,
  onSetSelection,
  onClearSelection,
}: FileViewerProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const dragStartLine = useRef<number | null>(null);
  const [error, setError] = useState<{
    message: string;
    isTooLarge?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!filePath) return;

    const fetchFile = async () => {
      setLoading(true);
      setError(null);
      setContent("");
      onClearSelection();

      try {
        const res = await fetch(
          `/api/files/read?path=${encodeURIComponent(filePath)}`,
        );
        const data = await res.json();

        if (data.error === "FILE_TOO_LARGE") {
          setError({ message: data.message, isTooLarge: true });
        } else if (data.error) {
          setError({ message: data.error });
        } else {
          setContent(data.content || "// No content found");
        }
      } catch (err) {
        setError({ message: "Failed to fetch file content." });
      } finally {
        setLoading(false);
      }
    };

    fetchFile();
  }, [filePath]);

  const applyRangeSelection = (toLine: number) => {
    if (dragStartLine.current === null || !content) return;
    const lines = content.split("\n");
    const lo = Math.min(dragStartLine.current, toLine);
    const hi = Math.max(dragStartLine.current, toLine);
    const selected = [];
    for (let i = lo; i <= hi; i++) {
      selected.push({ code: lines[i - 1] ?? "", num: i });
    }
    onSetSelection(selected);
  };

  const handleLineClick = (num: number) => {
    if (!content) return;
    const lines = content.split("\n");
    onLineToggle(lines[num - 1] ?? "", num);
  };

  if (!filePath) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-600">
        <div className="border-2 border-dashed border-zinc-800 p-8 rounded-xl text-center">
          <p className="text-xs font-mono italic">
            Select a file from the sidebar to view code
          </p>
        </div>
      </div>
    );
  }

  if (error?.isTooLarge) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="max-w-md p-6 border border-amber-900/50 bg-amber-950/20 rounded-lg">
            <h3 className="text-amber-500 font-bold mb-2 uppercase text-xs tracking-widest">
              ⚠️ File Too Large
            </h3>
            <p className="text-zinc-400 text-xs leading-relaxed">
              {error.message}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      onMouseUp={() => {
        dragStartLine.current = null;
      }}
      onMouseLeave={() => {
        dragStartLine.current = null;
      }}
    >
      {/* File header */}
      <div className="flex-none bg-zinc-900/80 px-4 py-2 border-b border-zinc-800 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-emerald-500 font-bold uppercase tracking-wider">
            {filePath}
          </span>
          {loading && (
            <Loader2 size={10} className="animate-spin text-zinc-500" />
          )}
        </div>
        {activeLines.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClearSelection();
            }}
            className="text-[9px] bg-zinc-800 hover:bg-red-950 hover:text-red-400 text-zinc-400 px-2 py-1 rounded border border-zinc-700 transition-colors font-bold uppercase tracking-tighter"
          >
            Clear ({activeLines.length})
          </button>
        )}
      </div>

      {/* Code */}
      <div className="flex-1 overflow-auto custom-scrollbar bg-[#1e1e1e]">
        {!loading && content && (
          <SyntaxHighlighter
            language="typescript"
            style={vscDarkPlus}
            showLineNumbers={true}
            wrapLines={true}
            lineProps={(lineNumber) => {
              const isActive = activeLines.includes(lineNumber);
              return {
                style: {
                  display: "block",
                  width: "100%",
                  cursor: "pointer",
                  backgroundColor: isActive
                    ? "rgba(16, 185, 129, 0.15)"
                    : "transparent",
                  borderLeft: isActive
                    ? "2px solid #10b981"
                    : "2px solid transparent",
                  transition: "background-color 0.05s ease",
                },
                onClick: () => handleLineClick(lineNumber),
                onMouseDown: (e: React.MouseEvent) => {
                  e.preventDefault();
                  dragStartLine.current = lineNumber;
                  onSetSelection([
                    {
                      code: content.split("\n")[lineNumber - 1] ?? "",
                      num: lineNumber,
                    },
                  ]);
                },
                onMouseEnter: () => {
                  if (dragStartLine.current !== null)
                    applyRangeSelection(lineNumber);
                },
              };
            }}
            customStyle={{
              margin: 0,
              padding: "20px 0",
              fontSize: "12px",
              lineHeight: "1.6",
              backgroundColor: "transparent",
            }}
            lineNumberStyle={{
              minWidth: "3.5em",
              paddingRight: "1em",
              color: "#555",
              textAlign: "right",
              userSelect: "none",
            }}
          >
            {content}
          </SyntaxHighlighter>
        )}
        {error && !error.isTooLarge && (
          <div className="p-8 text-red-500 text-xs font-mono bg-red-950/10 h-full">
            {error.message}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ContextPanel ────────────────────────────────────────────────────────

export default function ContextPanel({
  filePath,
  activeLines,
  onLineToggle,
  onSetSelection,
  onClearSelection,
  snippets = [],
  onDeleteSnippet,
  activeTab = "viewer",
  onTabChange,
}: ContextPanelProps) {
  return (
    <div className="flex flex-col h-full border-r border-zinc-800 bg-zinc-950 overflow-hidden">
      {/* Tab bar */}
      <div className="flex-none flex border-b border-zinc-800 bg-zinc-900/40">
        <button
          onClick={() => onTabChange?.("viewer")}
          className={`flex items-center gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 ${
            activeTab === "viewer"
              ? "border-emerald-500 text-emerald-400 bg-zinc-900/40"
              : "border-transparent text-zinc-600 hover:text-zinc-400"
          }`}
        >
          <FileCode size={11} />
          File Viewer
        </button>
        <button
          onClick={() => onTabChange?.("snippets")}
          className={`flex items-center gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 ${
            activeTab === "snippets"
              ? "border-emerald-500 text-emerald-400 bg-zinc-900/40"
              : "border-transparent text-zinc-600 hover:text-zinc-400"
          }`}
        >
          <BookOpen size={11} />
          Snippets
          {snippets.length > 0 && (
            <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-full font-mono">
              {snippets.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === "viewer" ? (
          <FileViewerTab
            filePath={filePath}
            activeLines={activeLines}
            onLineToggle={onLineToggle}
            onSetSelection={onSetSelection}
            onClearSelection={onClearSelection}
          />
        ) : (
          <SnippetLog snippets={snippets} onDelete={onDeleteSnippet} />
        )}
      </div>
    </div>
  );
}
