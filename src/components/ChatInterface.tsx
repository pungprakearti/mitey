"use client";

import { useEffect, useState, useRef, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface ChatInterfaceProps {
  activeFile: string | null;
  highlightedCode: string | null;
}

const ChatMessage = memo(({ m }: { m: any }) => (
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
      <div className="text-sm leading-relaxed font-medium">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ inline, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || "");
              return !inline && match ? (
                <SyntaxHighlighter
                  style={vscDarkPlus as any}
                  language={match[1]}
                  PreTag="div"
                  className="rounded-lg !my-4 !bg-zinc-950"
                  {...props}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              ) : (
                <code
                  className="bg-zinc-800 px-1 py-0.5 rounded text-emerald-400 font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            },
          }}
        >
          {m.content}
        </ReactMarkdown>
      </div>
    </div>
  </div>
));
ChatMessage.displayName = "ChatMessage";

export default function ChatInterface({
  activeFile,
  highlightedCode,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const accumulatedRef = useRef("");

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isLoading) return;

    const userMsg = { role: "user", content: chatInput };
    setMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setIsLoading(true);
    accumulatedRef.current = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg],
          activeFile,
          highlightedCode,
        }),
      });

      if (!response.ok) throw new Error("Mitey connection failed");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      // Initialize assistant message
      setMessages((prev) => [...prev, { role: "assistant", content: "..." }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            // Final flush of the decoder buffer
            const finalChunk = decoder.decode();
            if (finalChunk) {
              accumulatedRef.current += finalChunk;
              updateLastMessage(accumulatedRef.current);
            }
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          accumulatedRef.current += chunk;
          updateLastMessage(accumulatedRef.current);
        }
      }
    } catch (err) {
      console.error(err);
      updateLastMessage(
        "Mitey is having trouble connecting to the GPU right now. Please try again!",
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Helper to ensure state is updated correctly without race conditions
  const updateLastMessage = (content: string) => {
    setMessages((prev) => {
      const updated = [...prev];
      if (updated.length > 0) {
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: content,
        };
      }
      return updated;
    });
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950/40 border-l border-zinc-900 overflow-hidden">
      <div className="flex-none px-4 py-2 border-b border-zinc-800 bg-zinc-900/30 flex justify-between">
        <span className="text-[9px] font-black uppercase text-zinc-500">
          AI Context
        </span>
        <span className="text-[10px] font-mono text-emerald-500 truncate max-w-[150px]">
          {activeFile ? activeFile.split("/").pop() : "Global"}
        </span>
      </div>

      {highlightedCode && (
        <div className="flex-none px-4 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20">
          <p className="text-[9px] text-emerald-500 font-bold uppercase truncate">
            Focus: {highlightedCode}
          </p>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar"
      >
        {messages.map((m, idx) => (
          <ChatMessage key={idx} m={m} />
        ))}
        {isLoading && accumulatedRef.current === "" && (
          <div className="text-[10px] text-emerald-500 animate-pulse font-bold uppercase tracking-widest">
            Mitey is thinking...
          </div>
        )}
      </div>

      <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
        <form onSubmit={handleManualSubmit}>
          <input
            type="text"
            disabled={isLoading}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder={
              highlightedCode ? "Ask about this line..." : "Ask Mitey..."
            }
            className="w-full px-4 py-3 rounded-lg bg-zinc-950 border border-zinc-800 text-white outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
          />
        </form>
      </div>
    </div>
  );
}
