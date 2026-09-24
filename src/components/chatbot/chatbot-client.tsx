"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  FileText,
  Mail,
  MessageSquare,
  Paperclip,
  Send,
  AlertTriangle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Tab = "chat" | "mensajes" | "correos";

interface Contact {
  id: string;
  name: string;
  phone: string | null;
  stage: string | null;
}

type ChatMessage = { role: "user" | "agent"; text: string; timestamp?: string };

const TABS: { key: Tab; label: string; icon: typeof MessageSquare }[] = [
  { key: "chat", label: "Chat", icon: Bot },
  { key: "mensajes", label: "Envio Masivo", icon: MessageSquare },
  { key: "correos", label: "Correos Masivos", icon: Mail },
];

const MAX_FILE_SIZE = 16 * 1024 * 1024;

export function ChatbotClient() {
  const [tab, setTab] = useState<Tab>("chat");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight });
  }, [chatMessages]);

  const fetchContacts = useCallback(async () => {
    const res = await fetch("/api/contacts").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { contacts: Contact[] };
    setContacts(data.contacts);
  }, []);

  useEffect(() => {
    void fetchContacts();
  }, [fetchContacts]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const filtered = contacts.filter((c) =>
      query ? c.name.toLowerCase().includes(query.toLowerCase()) : true
    );
    setSelectedIds(new Set(filtered.map((c) => c.id)));
  };

  const deselectAll = () => setSelectedIds(new Set());

  // File handling
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) {
      setResult({ ok: false, message: "El archivo supera 16MB" });
      return;
    }
    setFile(f);
    if (f.type.startsWith("image/")) {
      setFilePreview(URL.createObjectURL(f));
    } else {
      setFilePreview(null);
    }
  };

  const removeFile = () => {
    setFile(null);
    setFilePreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleBulkMessage = async () => {
    if (!message.trim() || selectedIds.size === 0) return;
    setSending(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("contactIds", JSON.stringify(Array.from(selectedIds)));
      formData.append("message", message.trim());
      if (file) formData.append("file", file);

      const res = await fetch("/api/chatbot/bulk-message", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setResult({ ok: res.ok, message: data.message || (res.ok ? "Mensajes enviados" : "Error al enviar") });
      if (res.ok) { removeFile(); setMessage(""); }
    } catch {
      setResult({ ok: false, message: "Error de conexion" });
    }
    setSending(false);
  };

  const handleBulkEmail = async () => {
    if (!message.trim() || !subject.trim() || selectedIds.size === 0) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/chatbot/bulk-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactIds: Array.from(selectedIds),
          subject: subject.trim(),
          body: message.trim(),
        }),
      });
      const data = await res.json();
      setResult({ ok: res.ok, message: data.message || (res.ok ? "Correos enviados" : "Error al enviar") });
    } catch {
      setResult({ ok: false, message: "Error de conexion" });
    }
    setSending(false);
  };

  // Chat
  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatSending) return;
    setChatInput("");
    setChatSending(true);
    setChatError(null);

    setChatMessages((prev) => [...prev, { role: "user", text }]);

    const res = await fetch("/api/chatbot/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: text, conversationId: chatConversationId ?? undefined }),
    }).catch(() => null);

    setChatSending(false);

    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setChatError(data?.error?.message ?? "Error al enviar");
      setChatMessages((prev) => [...prev, { role: "agent", text: "(error al obtener respuesta)" }]);
      return;
    }

    const data = (await res.json()) as {
      conversationId: string;
      messages: ChatMessage[];
    };

    setChatConversationId(data.conversationId);
    setChatMessages(
      data.messages.map((m) => ({ role: m.role, text: m.text, timestamp: m.timestamp }))
    );
  }

  function newChat() {
    setChatMessages([]);
    setChatConversationId(null);
    setChatError(null);
  }

  const filteredContacts = contacts.filter((c) =>
    query ? c.name.toLowerCase().includes(query.toLowerCase()) : true
  );

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-brand" strokeWidth={1.8} />
          <h2 className="text-[17px] font-bold tracking-tight">Chatbot</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Centro de comandos: chat con IA, envio masivo y correos
        </p>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b px-4 sm:px-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="h-4 w-4" strokeWidth={1.8} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {/* Chat con IA */}
        {tab === "chat" && (
          <div className="flex h-full flex-col">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Habla con el asistente IA. Puede consultar contactos, pipeline, proyectos y mas.
              </p>
              <Button size="sm" variant="outline" onClick={newChat}>
                Nueva conversacion
              </Button>
            </div>

            <div
              ref={chatScrollRef}
              className="mb-3 flex-1 overflow-y-auto rounded-lg border bg-background p-4"
              style={{ minHeight: 300, maxHeight: 500 }}
            >
              {chatMessages.length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Escribe un mensaje para empezar...
                </p>
              )}
              <div className="space-y-3">
                {chatMessages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-foreground"
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                ))}
                {chatSending && (
                  <div className="flex justify-start">
                    <div className="rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
                      Pensando...
                    </div>
                  </div>
                )}
              </div>
            </div>

            {chatError && <p className="mb-2 text-sm text-destructive">{chatError}</p>}

            <div className="flex gap-2">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendChat();
                  }
                }}
                placeholder="Escribe tu pregunta..."
                disabled={chatSending}
              />
              <Button onClick={() => void sendChat()} disabled={chatSending || !chatInput.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Envio Masivo de Mensajes */}
        {tab === "mensajes" && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Seleccionar Contactos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="Buscar contacto..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="flex-1"
                  />
                  <Button variant="outline" size="sm" onClick={selectAll}>Todos</Button>
                  <Button variant="outline" size="sm" onClick={deselectAll}>Ninguno</Button>
                </div>
                <div className="max-h-48 overflow-y-auto rounded-md border p-2">
                  {filteredContacts.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">Sin contactos</p>
                  ) : (
                    <div className="space-y-1">
                      {filteredContacts.map((c) => (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(c.id)}
                            onChange={() => toggleSelect(c.id)}
                            className="h-3.5 w-3.5 rounded"
                          />
                          <span className="flex-1 truncate">{c.name}</span>
                          {c.stage && (
                            <Badge variant="outline" className="text-[10px]">{c.stage}</Badge>
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedIds.size} contacto{selectedIds.size !== 1 ? "s" : ""} seleccionado{selectedIds.size !== 1 ? "s" : ""}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Mensaje</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder="Escribe el mensaje a enviar..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                />

                {/* File attachment */}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.mp4,.mp3,.ogg,.opus"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {file ? (
                  <div className="flex items-center gap-2 rounded-md border bg-secondary/50 px-3 py-2">
                    {filePreview ? (
                      <img src={filePreview} alt="" className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <FileText className="h-8 w-8 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{file.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {(file.size / 1024).toFixed(0)} KB
                      </p>
                    </div>
                    <button
                      onClick={removeFile}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Paperclip className="mr-1.5 h-3.5 w-3.5" />
                    Adjuntar archivo
                  </Button>
                )}

                <Button
                  onClick={handleBulkMessage}
                  disabled={sending || !message.trim() || selectedIds.size === 0}
                >
                  <Send className="mr-1.5 h-4 w-4" />
                  {sending ? "Enviando..." : `Enviar a ${selectedIds.size} contacto${selectedIds.size !== 1 ? "s" : ""}`}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Envio Masivo de Correos */}
        {tab === "correos" && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Seleccionar Contactos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="Buscar contacto..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="flex-1"
                  />
                  <Button variant="outline" size="sm" onClick={selectAll}>Todos</Button>
                  <Button variant="outline" size="sm" onClick={deselectAll}>Ninguno</Button>
                </div>
                <div className="max-h-48 overflow-y-auto rounded-md border p-2">
                  {filteredContacts.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">Sin contactos</p>
                  ) : (
                    <div className="space-y-1">
                      {filteredContacts.map((c) => (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(c.id)}
                            onChange={() => toggleSelect(c.id)}
                            className="h-3.5 w-3.5 rounded"
                          />
                          <span className="flex-1 truncate">{c.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedIds.size} contacto{selectedIds.size !== 1 ? "s" : ""} seleccionado{selectedIds.size !== 1 ? "s" : ""}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Correo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  placeholder="Asunto"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
                <Textarea
                  placeholder="Escribe el cuerpo del correo..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={6}
                />
                <Button
                  onClick={handleBulkEmail}
                  disabled={sending || !message.trim() || !subject.trim() || selectedIds.size === 0}
                >
                  <Mail className="mr-1.5 h-4 w-4" />
                  {sending ? "Enviando..." : `Enviar a ${selectedIds.size} contacto${selectedIds.size !== 1 ? "s" : ""}`}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Result feedback */}
        {result && (
          <div className={`mt-4 flex items-center gap-2 rounded-md border p-3 text-sm ${
            result.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"
          }`}>
            {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {result.message}
          </div>
        )}
      </div>
    </div>
  );
}
