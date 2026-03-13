"use client";

import { useEffect, useState, useRef, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  Send,
  RotateCcw,
  FileCode,
  Square,
  Copy,
  Check,
  ChevronsDown,
  AlertCircle,
} from "lucide-react";
import type { Snippet } from "./ContextPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  cancelled?: boolean;
  // Set when the server returned a structured error instead of a stream
  isError?: boolean;
  errorCode?: string;
}

interface ChatInterfaceProps {
  activeFile: string | null;
  highlightedCode: string | null;
  generalModel: string;
  codeEditModel: string;
  initialMessages: Message[];
  onMessagesChange: (messages: Message[]) => void;
  onSnippetsExtracted: (snippets: Snippet[]) => void;
  onClearAll: () => void;
}

// ─── CodeBlock ────────────────────────────────────────────────────────────────

function CodeBlock({
  language,
  children,
}: {
  language: string;
  children: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-4">
      <button
        onClick={handleCopy}
        title="Copy code"
        className={`absolute top-2.5 right-2.5 z-10 p-1.5 rounded-md border transition-all
          ${
            copied
              ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
              : "bg-zinc-800/80 border-zinc-700/50 text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-300 hover:border-zinc-600"
          }`}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
      <SyntaxHighlighter
        style={vscDarkPlus as any}
        language={language}
        PreTag="div"
        className="rounded-lg !my-0 !bg-zinc-950 border border-zinc-800/50"
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

const MarkdownComponents = {
  code({ inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || "");
    const codeString = String(children).replace(/\n$/, "");
    return !inline && match ? (
      <CodeBlock language={match[1]}>{codeString}</CodeBlock>
    ) : (
      <code
        className="bg-zinc-800/50 px-1.5 py-0.5 rounded text-emerald-400 font-mono text-[0.9em]"
        {...props}
      >
        {children}
      </code>
    );
  },
};

// ─── Thought step renderer ────────────────────────────────────────────────────

function ThoughtBlock({ raw }: { raw: string }) {
  const stepMatches = [
    ...raw.matchAll(
      /(\*\*Step\s+\d+[^*]*?\*\*[^\n]*\n?)([\s\S]*?)(?=\*\*Step\s+\d+|$)/g,
    ),
  ];

  if (stepMatches.length === 0) {
    return (
      <div className="text-[13px] prose prose-invert prose-sm max-w-none opacity-80">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={MarkdownComponents}
        >
          {raw}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {stepMatches.map((match, i) => {
        const header = match[1].replace(/\*\*/g, "").trim();
        const body = match[2].trim();
        return (
          <div key={i} className="flex gap-3">
            <div className="shrink-0 w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mt-0.5">
              <span className="text-[9px] font-bold text-emerald-400">
                {i + 1}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-emerald-400/70 uppercase tracking-wider mb-1">
                {header
                  .replace(/^Step\s+\d+\s*[—\-]\s*/i, "")
                  .replace(/:$/, "")}
              </p>
              {body && (
                <div className="text-[12px] text-zinc-400 leading-relaxed">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={MarkdownComponents}
                  >
                    {body}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── ChatMessage ──────────────────────────────────────────────────────────────

const ChatMessage = memo(({ m }: { m: Message }) => {
  // ── Error message — distinct red styling, no thought block or RAG sources ──
  if (m.isError) {
    return (
      <div className="flex justify-start w-full">
        <div className="max-w-[95%] px-5 py-3 rounded-2xl shadow-xl overflow-hidden bg-red-950/40 border border-red-800/60 rounded-tl-none">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={12} className="text-red-400 shrink-0" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400">
              Mitey Error
            </span>
            {m.errorCode && (
              <span className="text-[9px] font-mono text-red-700 bg-red-950 border border-red-900 px-1.5 py-0.5 rounded">
                {m.errorCode}
              </span>
            )}
          </div>
          <p className="text-sm text-red-300 leading-relaxed font-medium">
            {m.content}
          </p>
        </div>
      </div>
    );
  }

  let content = m.content;

  // Auto-close failsafe for incomplete [THOUGHT] blocks during streaming
  if (content.includes("[THOUGHT]") && !content.includes("[/THOUGHT]")) {
    if (content.includes("```")) {
      content = content.replace("```", "[/THOUGHT]\n```");
    } else {
      content += "[/THOUGHT]";
    }
  }

  const thoughtRegex = /\[THOUGHT\]([\s\S]*?)\[\/THOUGHT\]/g;
  const thoughts = [...content.matchAll(thoughtRegex)].map((m) => m[1]);
  const cleanContent = content.replace(thoughtRegex, "").trim();

  return (
    <div
      className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} w-full`}
    >
      <div
        className={`max-w-[95%] px-5 py-3 rounded-2xl shadow-xl overflow-hidden ${
          m.role === "user"
            ? "bg-emerald-600 text-white rounded-tr-none"
            : "bg-zinc-900 border border-zinc-800 rounded-tl-none"
        }`}
      >
        <div className="text-[10px] mb-2 opacity-50 font-bold uppercase tracking-[0.2em]">
          {m.role === "user" ? "User" : "Mitey"}
        </div>

        {/* Structured reasoning block */}
        {thoughts.length > 0 && (
          <div className="mb-6 p-4 bg-zinc-950/40 border border-emerald-500/20 rounded-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500/20" />
            <p className="font-bold text-[9px] uppercase tracking-widest text-emerald-500/40 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/40 animate-pulse" />
              Reasoning Process
            </p>
            <ThoughtBlock raw={thoughts.join("\n\n")} />
          </div>
        )}

        {/* Main response */}
        <div className="text-sm leading-relaxed font-medium">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={MarkdownComponents}
          >
            {cleanContent || (m.role === "assistant" ? "..." : "")}
          </ReactMarkdown>
        </div>

        {/* Cancelled badge */}
        {m.cancelled && (
          <div className="mt-3 flex items-center gap-1.5">
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 border border-zinc-800 px-2 py-0.5 rounded-full">
              Cancelled
            </span>
          </div>
        )}

        {/* RAG Sources */}
        {m.sources && m.sources.length > 0 && (
          <div className="mt-4 pt-3 border-t border-zinc-800/60">
            <p className="text-[9px] uppercase tracking-widest text-zinc-600 font-bold mb-2">
              Context Sources
            </p>
            <div className="flex flex-wrap gap-1.5">
              {m.sources.map((source) => (
                <span
                  key={source}
                  className="flex items-center gap-1 text-[10px] font-mono text-zinc-500 bg-zinc-800/60 border border-zinc-700/50 px-2 py-0.5 rounded"
                >
                  <FileCode size={9} className="text-emerald-600 shrink-0" />
                  {source}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

ChatMessage.displayName = "ChatMessage";

// ─── Snippet extraction ───────────────────────────────────────────────────────
// Strip thought blocks first so [/THOUGHT] can never become a description.
// Then find the last meaningful line of text before each fenced code block.

// Lines that should never be used as descriptions
const JUNK_LINE = /^(\[\/?(THOUGHT|thought)\]|---|>\s*|#{1,6}\s*$|\s*)$/;

function extractSnippets(rawContent: string): Snippet[] {
  // Remove all [THOUGHT]...[/THOUGHT] blocks before scanning for descriptions
  const content = rawContent.replace(/\[THOUGHT\][\s\S]*?\[\/THOUGHT\]/g, "");

  const snippets: Snippet[] = [];
  const blockRegex = /```(\w+)\n([\s\S]*?)```/g;
  let match;

  while ((match = blockRegex.exec(content)) !== null) {
    const language = match[1];
    const code = match[2].trim();
    if (!code) continue;

    // Walk backwards through lines before this block to find a real description
    const before = content.slice(0, match.index);
    const lines = before.split("\n").reverse();

    let description = "Code snippet from Mitey";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || JUNK_LINE.test(trimmed)) continue;
      // Strip common markdown formatting
      description = trimmed
        .replace(/^#+\s*/, "") // headings
        .replace(/\*\*/g, "") // bold
        .replace(/`/g, "") // inline code ticks
        .replace(/^[-*]\s+/, "") // list bullets
        .trim();
      break;
    }

    snippets.push({
      id: crypto.randomUUID(),
      description,
      language,
      code,
      timestamp: Date.now(),
    });
  }

  return snippets;
}

// ─── Main ChatInterface ───────────────────────────────────────────────────────

export default function ChatInterface({
  activeFile,
  highlightedCode,
  generalModel,
  codeEditModel,
  initialMessages,
  onMessagesChange,
  onSnippetsExtracted,
  onClearAll,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [chatInput, setChatInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const accumulatedRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const userScrolledRef = useRef(false);

  // Sync initialMessages when history loads from disk after mount
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  // Notify parent whenever messages change so it can persist to disk
  useEffect(() => {
    onMessagesChange(messages);
  }, [messages]);

  // ── Scroll ──────────────────────────────────────────────────────────────────

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (isNearBottom()) {
        userScrolledRef.current = false;
        setShowScrollButton(false);
      } else {
        userScrolledRef.current = true;
        if (isLoading) setShowScrollButton(true);
      }
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [isLoading]);

  useEffect(() => {
    if (!userScrolledRef.current) scrollToBottom();
  }, [messages]);

  // ── Keyboard ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isLoading) handleCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLoading]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isLoading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: chatInput,
    };

    const sanitizedHistory = messages.map((m) => {
      if (m.role === "assistant") {
        return {
          ...m,
          content: m.content
            .replace(/\[THOUGHT\][\s\S]*?\[\/THOUGHT\]/g, "")
            .trim(),
        };
      }
      return m;
    });

    const messagesForApi = [...sanitizedHistory, userMsg];

    setMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setIsLoading(true);
    accumulatedRef.current = "";
    userScrolledRef.current = false;
    setShowScrollButton(false);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messagesForApi,
          activeFile,
          highlightedCode,
          generalModel,
          codeEditModel,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error("Mitey connection failed");

      // Check if server returned a structured error instead of a stream
      if (response.headers.get("X-Mitey-Error") === "1") {
        const { code, message } = await response.json();
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: message,
            isError: true,
            errorCode: code,
          },
        ]);
        return;
      }

      const sourcesHeader = response.headers.get("X-Mitey-Sources");
      const sources: string[] = sourcesHeader ? JSON.parse(sourcesHeader) : [];

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: "", sources },
      ]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulatedRef.current += decoder.decode(value, { stream: true });
          updateLastMessage(accumulatedRef.current);
        }
      }

      // Extract and bubble up any code snippets
      const snippets = extractSnippets(accumulatedRef.current);
      if (snippets.length > 0) onSnippetsExtracted(snippets);
    } catch (err: any) {
      if (err.name === "AbortError") {
        markLastMessageCancelled();
      } else {
        console.error(err);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              "Could not reach Mitey. Make sure Ollama is running and try again.",
            isError: true,
            errorCode: "CONNECTION_FAILED",
          },
        ]);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      setShowScrollButton(false);
      // Delay focus until after the re-render that re-enables the input
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const updateLastMessage = (content: string) => {
    setMessages((prev) => {
      const updated = [...prev];
      if (updated.length > 0) {
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content,
        };
      }
      return updated;
    });
  };

  const markLastMessageCancelled = () => {
    setMessages((prev) => {
      const updated = [...prev];
      if (updated.length > 0) {
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          cancelled: true,
        };
      }
      return updated;
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-zinc-950/40 border-l border-zinc-900 overflow-hidden">
      {/* Header */}
      <div className="flex-none px-4 py-2 border-b border-zinc-800 bg-zinc-900/30 flex justify-between items-center">
        <span className="text-[9px] font-black uppercase text-zinc-500">
          AI Context
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-zinc-600 italic">
            {generalModel}
          </span>
          <span className="text-zinc-800">|</span>
          <span className="text-[10px] font-mono text-emerald-500 truncate max-w-[150px]">
            {activeFile ? activeFile.split("/").pop() : "Global"}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-hidden relative">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto p-6 space-y-6 custom-scrollbar"
        >
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 opacity-30">
              <div className="w-8 h-8 rounded-full border-2 border-emerald-500/50 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
              </div>
              <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest">
                Ask Mitey anything
              </p>
            </div>
          )}
          {messages.map((m) => (
            <ChatMessage key={m.id} m={m} />
          ))}
          {isLoading && accumulatedRef.current === "" && (
            <div className="text-[10px] text-emerald-500 animate-pulse font-bold uppercase tracking-widest">
              Mitey is reasoning...
            </div>
          )}
        </div>

        {showScrollButton && (
          <button
            onClick={() => {
              userScrolledRef.current = false;
              setShowScrollButton(false);
              scrollToBottom();
            }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-emerald-400 hover:border-emerald-500/50 text-[10px] font-bold uppercase tracking-widest transition-all shadow-lg"
          >
            <ChevronsDown size={12} />
            Jump to bottom
          </button>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
        <form onSubmit={handleSubmit}>
          <div className="flex gap-2 items-center">
            {/* Reset — now triggers the parent's full clear with confirmation */}
            <button
              type="button"
              onClick={onClearAll}
              title="Clear History"
              disabled={isLoading}
              className="shrink-0 p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-red-400 hover:border-red-900/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <RotateCcw size={14} />
            </button>

            <input
              ref={inputRef}
              type="text"
              disabled={isLoading}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={
                isLoading ? "Streaming... (Esc to cancel)" : "Ask Mitey..."
              }
              className="flex-1 px-4 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-white outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 text-sm placeholder:text-zinc-600"
            />

            {isLoading ? (
              <button
                type="button"
                onClick={handleCancel}
                title="Cancel (Esc)"
                className="shrink-0 p-2.5 rounded-lg bg-red-900/60 hover:bg-red-800 border border-red-800/50 text-red-400 hover:text-red-300 transition-all"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!chatInput.trim()}
                title="Send"
                className="shrink-0 p-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all"
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
