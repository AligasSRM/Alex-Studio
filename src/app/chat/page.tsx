"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  tokens?: number;
  costUsd?: number;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hello! I'm Alex Studio AI. Describe what you'd like to build or change, and I'll create a plan for you.",
    },
  ]);
  const [input, setInput] = useState("");
  const [projectId, setProjectId] = useState("");
  const [totalCostUsd, setTotalCostUsd] = useState(0);
  const [loading, setLoading] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setProjectId(new URLSearchParams(window.location.search).get("project") || "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    if (!projectId) {
      setMessages((prev) => [...prev, { role: "assistant", content: "Select a project first from Projects, then open its AI Chat link. Usage is tracked per project." }]);
      return;
    }

    const userMessage: Message = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${data.error || "Unknown error"}` },
        ]);
        return;
      }

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response, tokens: data.usage?.totalTokens, costUsd: data.usage?.costTracked ? data.usage?.costUsd : undefined },
      ]);
      setTotalTokens((prev) => prev + (data.usage?.totalTokens || 0));
      if (data.usage?.costTracked) setTotalCostUsd((prev) => prev + (data.usage?.costUsd || 0));
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Network error. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-4 border-b border-gray-200 bg-white">
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-bold">AI Chat</h1>
          <div className="text-right text-sm text-gray-500">
            <div>Tokens used (estimate/provider): {totalTokens}</div>
            <div>Tracked cost this session: ${totalCostUsd.toFixed(6)}</div>
            <div className="text-xs">Project: {projectId || "not selected"}</div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] p-3 rounded-lg whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {msg.content}
              {msg.tokens !== undefined && (
                <div className="text-xs opacity-60 mt-1">
                  {msg.tokens} tokens{msg.costUsd !== undefined ? ` · ${msg.costUsd.toFixed(6)}` : ""}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 p-3 rounded-lg text-gray-500">
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build or change..."
            className="flex-1 p-3 border border-gray-300 rounded-lg resize-none"
            rows={2}
            disabled={loading || !projectId}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim() || !projectId}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
