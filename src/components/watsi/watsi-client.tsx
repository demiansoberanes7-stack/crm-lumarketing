"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Plus, Trash2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

interface Message {
  id: string;
  role: string;
  content: string;
}

const SUGGESTIONS = [
  "¿Cuántos leads tengo esta semana?",
  "¿De qué me escribe la gente?",
  "¿Cuánto dinero he cobrado este mes?",
  "¿Qué tareas tengo vencidas?",
  "¿Cuántas cotizaciones están pendientes?",
];

export function WatsiClient() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [mobileList, setMobileList] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/watsi/conversations").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { conversations: Conversation[] };
    setConversations(data.conversations);
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function loadMessages(id: string) {
    setActiveId(id);
    setMobileList(false);
    const res = await fetch(`/api/watsi/conversations/${id}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { messages: Message[] };
    setMessages(data.messages);
  }

  async function newConversation() {
    setActiveId(null);
    setMessages([]);
    setMobileList(false);
  }

  async function deleteConversation(id: string) {
    if (!confirm("¿Eliminar esta conversación?")) return;
    await fetch(`/api/watsi/conversations/${id}`, { method: "DELETE" }).catch(() => null);
    void loadConversations();
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
  }

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput("");
    setSending(true);

    // Optimistic: add user message
    setMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, role: "user", content: msg }]);

    try {
      const res = await fetch("/api/watsi/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: msg, conversationId: activeId ?? undefined }),
      });
      const data = (await res.json()) as { conversationId: string; response: string; error?: { message: string } };
      if (!res.ok) {
        setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: "assistant", content: data.error?.message ?? "Error al procesar" }]);
        return;
      }
      setMessages((prev) => [...prev, { id: `resp-${Date.now()}`, role: "assistant", content: data.response }]);
      if (!activeId) {
        setActiveId(data.conversationId);
        void loadConversations();
      }
    } catch {
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: "assistant", content: "Error de conexión" }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar de conversaciones */}
      <aside
        className={cn(
          "flex w-full shrink-0 flex-col border-r bg-card md:w-[280px]",
          !mobileList && "hidden md:flex"
        )}
      >
        <div className="border-b p-3">
          <Button size="sm" className="w-full" onClick={() => void newConversation()}>
            <Plus className="mr-1.5 h-4 w-4" />
            Nueva conversación
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              Aún no tienes conversaciones.
            </p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-3 py-2.5 text-sm cursor-pointer transition-colors",
                    activeId === c.id ? "bg-accent font-medium" : "hover:bg-accent/50"
                  )}
                  onClick={() => void loadMessages(c.id)}
                >
                  <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); void deleteConversation(c.id); }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    aria-label="Eliminar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Panel de chat */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              className="md:hidden rounded p-1 text-muted-foreground"
              onClick={() => setMobileList(true)}
              aria-label="Volver a conversaciones"
            >
              ←
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-bold">asistente</h2>
              <p className="text-[11px] text-muted-foreground">Tu copiloto del espacio de trabajo</p>
            </div>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border">
                <Sparkles className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-lg font-semibold">Hola, soy asistente</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Pregúntame por tus leads, conversaciones, citas y métricas. Reviso tus datos reales antes de responderte.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "flex",
                    m.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-muted px-4 py-2.5">
                    <span className="animate-pulse text-sm text-muted-foreground">asistente está escribiendo…</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t p-3">
          <form
            onSubmit={(e) => { e.preventDefault(); void send(); }}
            className="mx-auto flex max-w-2xl items-center gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu pregunta…"
              disabled={sending}
              className="flex-1"
            />
            <Button type="submit" size="icon" disabled={sending || !input.trim()} aria-label="Enviar">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
