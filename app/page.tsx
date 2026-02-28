"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

export default function MiteyPage() {
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("Initializing Mitey...");

  useEffect(() => {
    // Check if Mitey is ready and project is scanned
    fetch("/api/init")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setStatus(
            `Small, but Mighty! Ready to scan ${data.fileCount} files.`,
          );
        }
      })
      .catch(() => setStatus("Mitey is offline."));
  }, []);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isLoading) return;

    const userMessage = { role: "user", content: chatInput };
    const updatedMessages = [...messages, userMessage];

    setMessages(updatedMessages);
    setChatInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages }),
      });

      if (!response.ok) throw new Error("Failed to fetch");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";

      // Add a placeholder message for Mitey's response
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          assistantContent += chunk;

          // Update the last message in real-time as the stream flows
          setMessages((prev) => {
            const newMsgs = [...prev];
            newMsgs[newMsgs.length - 1].content = assistantContent;
            return newMsgs;
          });
        }
      }
    } catch (err) {
      console.error("Manual Send Error:", err);
      setStatus("Mitey had a connection error.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-300 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
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

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center opacity-25 text-center">
            <p className="text-5xl font-black italic tracking-tighter text-emerald-500">
              MITEY
            </p>
            <p className="mt-2 font-mono text-sm uppercase tracking-widest text-zinc-400">
              Standing by for code analysis.
            </p>
          </div>
        )}

        {messages.map((m: any, idx: number) => (
          <div
            key={idx}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[90%] px-5 py-3 rounded-2xl shadow-xl ${
                m.role === "user"
                  ? "bg-emerald-600 text-white rounded-tr-none"
                  : "bg-zinc-900 border border-zinc-800 rounded-tl-none"
              }`}
            >
              <div className="text-[10px] mb-2 opacity-50 font-bold uppercase tracking-[0.2em]">
                {m.role === "user" ? "User" : "Mitey"}
              </div>

              {/* Markdown Content Area */}
              <div className="text-sm leading-relaxed font-medium">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ node, inline, className, children, ...props }: any) {
                      const match = /language-(\w+)/.exec(className || "");
                      return !inline && match ? (
                        <div className="my-4 rounded-lg overflow-hidden border border-zinc-700 shadow-2xl">
                          <div className="bg-zinc-800 px-4 py-1 text-[10px] text-zinc-400 border-b border-zinc-700 font-mono flex justify-between">
                            <span>{match[1].toUpperCase()}</span>
                          </div>
                          <SyntaxHighlighter
                            style={vscDarkPlus as any}
                            language={match[1]}
                            PreTag="div"
                            className="!m-0 !bg-zinc-950"
                            {...props}
                          >
                            {String(children).replace(/\n$/, "")}
                          </SyntaxHighlighter>
                        </div>
                      ) : (
                        <code
                          className="bg-zinc-800 px-1.5 py-0.5 rounded text-emerald-400 font-mono text-xs"
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    },
                    ul: ({ children }) => (
                      <ul className="list-disc ml-6 my-2 space-y-1">
                        {children}
                      </ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="list-decimal ml-6 my-2 space-y-1">
                        {children}
                      </ol>
                    ),
                    p: ({ children }) => (
                      <p className="mb-4 last:mb-0">{children}</p>
                    ),
                  }}
                >
                  {m.content}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        ))}

        {isLoading && !messages[messages.length - 1]?.content && (
          <div className="flex gap-1.5 items-center px-4 py-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-6 bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-transparent">
        <form
          onSubmit={handleManualSubmit}
          className="relative group max-w-5xl mx-auto"
        >
          <input
            className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl px-6 py-5 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all shadow-2xl"
            value={chatInput}
            placeholder="Ask Mitey about your project..."
            onChange={(e) => setChatInput(e.target.value)}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !chatInput.trim()}
            className="absolute right-4 top-1/2 -translate-y-1/2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-4 py-2 rounded-lg text-xs font-black transition-all"
          >
            {isLoading ? "WORKING" : "SEND"}
          </button>
        </form>
      </div>
    </div>
  );
}
