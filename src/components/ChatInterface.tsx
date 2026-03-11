"use client";

import { useEffect, useState, useRef, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Send, RotateCcw, FileCode } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

interface ChatInterfaceProps {
  activeFile: string | null;
  highlightedCode: string | null;
  selectedModel: string;
}

const MarkdownComponents = {
  code({ inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || "");
    return !inline && match ? (
      <SyntaxHighlighter
        style={vscDarkPlus as any}
        language={match[1]}
        PreTag="div"
        className="rounded-lg !my-4 !bg-zinc-950 border border-zinc-800/50"
        {...props}
      >
        {String(children).replace(/\n$/, "")}
      </SyntaxHighlighter>
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

const ChatMessage = memo(({ m }: { m: Message }) => {
  let content = m.content;

  // Auto-close failsafe for incomplete [THOUGHT] blocks
  if (content.includes("[THOUGHT]") && !content.includes("[/THOUGHT]")) {
    if (content.includes("```")) {
      content = content.replace("```", "[/THOUGHT]\n```");
    } else {
      content += "[/THOUGHT]";
    }
  }

  const thoughtRegex = /\[THOUGHT\]([\s\S]*?)\[\/THOUGHT\]/g;
  const thoughts = [...content.matchAll(thoughtRegex)].map((match) => match[1]);
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

        {/* Reasoning block */}
        {thoughts.length > 0 && (
          <div className="mb-6 p-4 bg-zinc-950/40 border border-emerald-500/20 rounded-xl text-zinc-400 font-light leading-relaxed relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500/20" />
            <p className="not-italic font-bold text-[9px] uppercase tracking-widest text-emerald-500/40 mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/40 animate-pulse" />
              Reasoning Process
            </p>
            <div className="text-[13px] prose prose-invert prose-sm max-w-none opacity-80">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={MarkdownComponents}
              >
                {thoughts.join("\n\n")}
              </ReactMarkdown>
            </div>
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

export default function ChatInterface({
  activeFile,
  highlightedCode,
  selectedModel,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const accumulatedRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isLoading) return;

    const userMsg: Message = { role: "user", content: chatInput };

    // Sanitize history: strip [THOUGHT] blocks from past assistant replies before sending
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

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messagesForApi,
          activeFile,
          highlightedCode,
          selectedModel,
        }),
      });

      if (!response.ok) throw new Error("Mitey connection failed");

      // Read RAG sources from response header
      const sourcesHeader = response.headers.get("X-Mitey-Sources");
      const sources: string[] = sourcesHeader ? JSON.parse(sourcesHeader) : [];

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      // Add empty assistant message to stream into
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", sources },
      ]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          accumulatedRef.current += chunk;
          updateLastMessage(accumulatedRef.current);
        }
      }
    } catch (err) {
      console.error(err);
      updateLastMessage(
        "Mitey encountered an error. Check that Ollama is running locally.",
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
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

  return (
    <div className="flex flex-col h-full bg-zinc-950/40 border-l border-zinc-900 overflow-hidden">
      {/* Header */}
      <div className="flex-none px-4 py-2 border-b border-zinc-800 bg-zinc-900/30 flex justify-between items-center">
        <span className="text-[9px] font-black uppercase text-zinc-500">
          AI Context
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-zinc-600 italic">
            {selectedModel}
          </span>
          <span className="text-zinc-800">|</span>
          <span className="text-[10px] font-mono text-emerald-500 truncate max-w-[150px]">
            {activeFile ? activeFile.split("/").pop() : "Global"}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar"
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
        {messages.map((m, idx) => (
          <ChatMessage key={idx} m={m} />
        ))}
        {isLoading && accumulatedRef.current === "" && (
          <div className="text-[10px] text-emerald-500 animate-pulse font-bold uppercase tracking-widest">
            Mitey is reasoning...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
        <form onSubmit={handleSubmit}>
          <div className="flex gap-2 items-center">
            {/* Reset button */}
            <button
              type="button"
              onClick={() => setMessages([])}
              title="Clear Chat"
              className="shrink-0 p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-emerald-500 hover:border-emerald-500/50 transition-all"
            >
              <RotateCcw size={14} />
            </button>

            {/* Text input */}
            <input
              ref={inputRef}
              type="text"
              disabled={isLoading}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask Mitey..."
              className="flex-1 px-4 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-white outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 text-sm"
            />

            {/* Send button */}
            <button
              type="submit"
              disabled={isLoading || !chatInput.trim()}
              title="Send"
              className="shrink-0 p-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all"
            >
              <Send size={14} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
