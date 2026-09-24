"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clock,
  FileSearch,
  Mail,
  MessageSquare,
  Search,
  Send,
  Users,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Tab = "mensajes" | "correos" | "seguimientos" | "datos";

interface Contact {
  id: string;
  name: string;
  phone: string | null;
  stage: string | null;
}

interface FollowUp {
  contactId: string;
  contactName: string;
  stage: string;
  lastActivity: string;
  daysSinceActivity: number;
}

const TABS: { key: Tab; label: string; icon: typeof MessageSquare }[] = [
  { key: "mensajes", label: "Envio Masivo", icon: MessageSquare },
  { key: "correos", label: "Correos Masivos", icon: Mail },
  { key: "seguimientos", label: "Seguimientos", icon: Clock },
  { key: "datos", label: "Datos", icon: FileSearch },
];

export function ChatbotClient() {
  const [tab, setTab] = useState<Tab>("mensajes");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loadingFollowUps, setLoadingFollowUps] = useState(false);
  const [searchField, setSearchField] = useState("");
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);

  const fetchContacts = useCallback(async () => {
    const res = await fetch("/api/contacts").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { contacts: Contact[] };
    setContacts(data.contacts);
  }, []);

  const fetchFollowUps = useCallback(async () => {
    setLoadingFollowUps(true);
    const res = await fetch("/api/pipeline/leads").catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as { leads: FollowUp[] };
      setFollowUps(data.leads);
    }
    setLoadingFollowUps(false);
  }, []);

  useEffect(() => {
    void fetchContacts();
  }, [fetchContacts]);

  useEffect(() => {
    if (tab === "seguimientos") void fetchFollowUps();
  }, [tab, fetchFollowUps]);

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

  const handleBulkMessage = async () => {
    if (!message.trim() || selectedIds.size === 0) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/chatbot/bulk-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactIds: Array.from(selectedIds),
          message: message.trim(),
        }),
      });
      const data = await res.json();
      setResult({ ok: res.ok, message: data.message || (res.ok ? "Mensajes enviados" : "Error al enviar") });
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

  const handleSearch = async () => {
    if (!searchField.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/contacts?q=${encodeURIComponent(searchField.trim())}`).catch(() => null);
      if (res?.ok) {
        const data = (await res.json()) as { contacts: Contact[] };
        setSearchResults(data.contacts);
      }
    } catch { /* empty */ }
    setSearching(false);
  };

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
          Centro de comandos para acciones masivas y seguimientos
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

        {/* Seguimientos */}
        {tab === "seguimientos" && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Seguimientos Pendientes</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingFollowUps ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">Cargando...</p>
                ) : followUps.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    No hay seguimientos pendientes
                  </p>
                ) : (
                  <div className="space-y-2">
                    {followUps.map((f) => (
                      <div
                        key={f.contactId}
                        className="flex items-center justify-between rounded-md border px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{f.contactName}</p>
                          <p className="text-xs text-muted-foreground">
                            {f.stage} · {f.daysSinceActivity} dias sin actividad
                          </p>
                        </div>
                        <Badge
                          variant={f.daysSinceActivity > 7 ? "destructive" : f.daysSinceActivity > 3 ? "warning" : "secondary"}
                        >
                          {f.daysSinceActivity > 7 ? "Urgente" : f.daysSinceActivity > 3 ? "Seguir" : "Reciente"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Datos */}
        {tab === "datos" && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Buscar en el CRM</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="Buscar por nombre o telefono..."
                    value={searchField}
                    onChange={(e) => setSearchField(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleSearch(); }}
                    className="flex-1"
                  />
                  <Button onClick={handleSearch} disabled={searching}>
                    <Search className="mr-1.5 h-4 w-4" />
                    Buscar
                  </Button>
                </div>
                {searchResults.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {searchResults.length} resultado{searchResults.length !== 1 ? "s" : ""}
                    </p>
                    {searchResults.map((c) => (
                      <div key={c.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.phone || "Sin telefono"}</p>
                        </div>
                        {c.stage && <Badge variant="outline">{c.stage}</Badge>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Resumen del CRM</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-md border p-3 text-center">
                    <Users className="mx-auto h-4 w-4 text-muted-foreground" />
                    <p className="mt-1 text-lg font-bold">{contacts.length}</p>
                    <p className="text-[10px] text-muted-foreground">Contactos</p>
                  </div>
                  <div className="rounded-md border p-3 text-center">
                    <MessageSquare className="mx-auto h-4 w-4 text-muted-foreground" />
                    <p className="mt-1 text-lg font-bold">{followUps.length}</p>
                    <p className="text-[10px] text-muted-foreground">Seguimientos</p>
                  </div>
                </div>
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
