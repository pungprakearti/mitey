"use client";

import { useEffect, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface FileViewerProps {
  filePath: string | null;
  onLineToggle: (code: string, num: number) => void;
  onClearSelection: () => void;
  activeLines: number[];
}

export default function FileViewer({
  filePath,
  onLineToggle,
  onClearSelection,
  activeLines,
}: FileViewerProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [isMouseDown, setIsMouseDown] = useState(false);
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
      onClearSelection(); // Reset highlights when switching files

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

  const handleAction = (num: number) => {
    if (!content) return;
    const lines = content.split("\n");
    onLineToggle(lines[num - 1], num);
  };

  // 1. Placeholder when no file is selected
  if (!filePath) {
    return (
      <div className="h-full flex flex-col items-center justify-center border-r border-zinc-800 bg-zinc-900/10 text-zinc-600">
        <div className="border-2 border-dashed border-zinc-800 p-8 rounded-xl text-center">
          <p className="text-xs font-mono italic">
            Select a file from the sidebar to view code
          </p>
        </div>
      </div>
    );
  }

  // 2. THE SAFETY SHIELD: Handle Large Files
  if (error?.isTooLarge) {
    return (
      <div className="flex flex-col h-full border-r border-zinc-800 bg-zinc-950">
        <div className="flex-none bg-zinc-900/80 px-4 py-2 border-b border-zinc-800">
          <span className="text-[10px] font-mono text-amber-500 font-bold uppercase tracking-wider">
            {filePath}
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="max-w-md p-6 border border-amber-900/50 bg-amber-950/20 rounded-lg">
            <h3 className="text-amber-500 font-bold mb-2 uppercase text-xs tracking-widest">
              ⚠️ File Too Large
            </h3>
            <p className="text-zinc-400 text-xs leading-relaxed">
              {error.message}
            </p>
            <p className="text-zinc-500 text-[10px] mt-4 italic">
              Rendering this file would likely crash your browser session.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full border-r border-zinc-800 bg-zinc-950 overflow-hidden select-none"
      onMouseDown={() => setIsMouseDown(true)}
      onMouseUp={() => setIsMouseDown(false)}
      onMouseLeave={() => setIsMouseDown(false)}
    >
      {/* Header */}
      <div className="flex-none bg-zinc-900/80 px-4 py-2 border-b border-zinc-800 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-emerald-500 font-bold uppercase tracking-wider">
            {filePath}
          </span>
          {loading && (
            <span className="text-[10px] animate-pulse text-zinc-500 uppercase">
              Loading...
            </span>
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
            Clear Selection ({activeLines.length})
          </button>
        )}
      </div>

      {/* Code Viewer */}
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
                onClick: () => handleAction(lineNumber),
                onMouseEnter: () => {
                  if (isMouseDown && !isActive) handleAction(lineNumber);
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

        {/* General Error (Non-size related) */}
        {error && !error.isTooLarge && (
          <div className="p-8 text-red-500 text-xs font-mono bg-red-950/10 h-full">
            {error.message}
          </div>
        )}
      </div>
    </div>
  );
}
