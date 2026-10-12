"use client";

import { useRef, useState } from "react";
import { Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bufferToBase64 } from "@/lib/base64";

export type EmailAttachment = { filename: string; content: string; contentType: string };

/**
 * Diálogo de redacción de correo nuevo, compartido entre Ajustes → Buzón y el
 * Buzón de la Bandeja. Own estado y el POST a /api/email/messages; el padre
 * solo decide cuándo abrirlo y qué refrescar después de enviar.
 */
export function EmailComposeDialog({
  accountId,
  onClose,
  onSent,
}: {
  accountId: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const next: EmailAttachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) {
        setError(`El archivo ${file.name} supera 10MB`);
        continue;
      }
      const buffer = await file.arrayBuffer();
      const base64 = bufferToBase64(buffer);
      next.push({ filename: file.name, content: base64, contentType: file.type || "application/octet-stream" });
    }
    setAttachments((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    const res = await fetch("/api/email/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId,
        to,
        subject,
        text: body,
        attachments: attachments.length > 0 ? attachments : undefined,
      }),
    }).catch(() => null);
    setSending(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo enviar el correo.");
      return;
    }
    onSent?.();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button aria-label="Cerrar" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div className="relative z-10 max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border bg-card pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold">Nuevo mensaje</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={(e) => void handleSend(e)} className="flex flex-col">
          {error && (
            <div role="alert" className="mx-5 mt-3 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="flex items-center gap-2 border-b px-5 py-2.5">
            <Label className="w-12 text-xs text-muted-foreground">Para</Label>
            <Input
              type="email"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="correo@ejemplo.com"
              className="border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center gap-2 border-b px-5 py-2.5">
            <Label className="w-12 text-xs text-muted-foreground">Asunto</Label>
            <Input
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Asunto del correo"
              className="border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
          <textarea
            required
            rows={10}
            placeholder="Escribe tu mensaje..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-[200px] resize-none border-0 bg-transparent px-5 py-3 text-sm outline-none placeholder:text-muted-foreground/50"
          />
          {attachments.length > 0 && (
            <div className="border-t px-5 py-2">
              <ul className="space-y-1">
                {attachments.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs">
                    <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{a.filename}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-center justify-between border-t px-5 py-3">
            <div className="flex items-center gap-1">
              <Button type="submit" disabled={sending} className="rounded-full bg-blue-600 px-6 text-white hover:bg-blue-700">
                <Send className="mr-1.5 h-3.5 w-3.5" />
                {sending ? "Enviando..." : "Enviar"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                multiple
                className="hidden"
                onChange={(e) => void handleFileChange(e)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                aria-label="Adjuntar archivo"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </div>
            <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
              Descartar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
