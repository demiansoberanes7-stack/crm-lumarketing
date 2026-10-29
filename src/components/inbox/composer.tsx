"use client";

import { useEffect, useRef, useState } from "react";
import {
  FileText,
  MapPin,
  Paperclip,
  Plus,
  Send,
  UserRound,
  X,
} from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatBytes, formatRemaining } from "./helpers";

/** 008 — Panel secundario del clip: formulario de ubicación o contacto. */
type AttachPanel = "location" | "contact" | null;

/** Extrae lat,long de "21.019, -101.257" o de un enlace de Google Maps. */
function parseCoords(raw: string): { latitude: number; longitude: number } | null {
  const m =
    raw.match(/(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/) ??
    raw.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function Composer({
  conversation,
  onSend,
  onSent,
}: {
  conversation: ConversationDto;
  onSend: (text: string) => Promise<string | null>;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [panel, setPanel] = useState<AttachPanel>(null);
  const [coordsRaw, setCoordsRaw] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  /** Hoja inferior de adjuntos (solo celular): el patrón «+» de las apps de mensajería. */
  const [sheetOpen, setSheetOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // La URL del preview de imagen se libera al reemplazar/limpiar el archivo.
  useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    };
  }, [filePreview]);

  function autogrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  function pickFile(f: File | null) {
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFile(f);
    setFilePreview(f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    setPanel(null);
    setError(null);
  }

  async function apiSend(path: string, init: RequestInit): Promise<string | null> {
    const res = await fetch(path, init);
    if (res.ok) return null;
    const data = (await res.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
    return data?.error?.message ?? data?.message ?? `Error ${res.status}`;
  }

  async function submit() {
    setError(null);

    if (file) {
      // El adjunto sí espera: sube el archivo y no tiene sentido encolar otro
      // mientras tanto.
      if (sending) return;
      setSending(true);
      const form = new FormData();
      form.set("file", file);
      const caption = text.trim();
      if (caption) form.set("caption", caption);
      const err = await apiSend(
        `/api/conversations/${conversation.id}/messages/media`,
        { method: "POST", body: form }
      );
      setSending(false);
      if (err) {
        setError(err);
        return;
      }
      pickFile(null);
      setText("");
      if (taRef.current) taRef.current.style.height = "auto";
      onSent();
      return;
    }

    const value = text.trim();
    if (!value) return;
    // Aquí NO se espera al servidor. Enviar tarda ~1.5 s (el viaje a Meta) y
    // durante ese rato el renglón siguiente se escribía encima del anterior y
    // salía todo como un solo mensaje. El campo se limpia ya; la burbuja
    // "enviando" del hilo es la que informa el estado real.
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
    const err = await onSend(value);
    if (err) {
      setError(err);
      // Lo que no salió vuelve al campo. Si ya empezaste a escribir otra cosa
      // se antepone en vez de pisarte: nada se pierde en silencio.
      setText((actual) => (actual ? `${value}\n${actual}` : value));
      taRef.current?.focus();
      setTimeout(autogrow, 0);
    }
  }

  async function submitLocation() {
    const coords = parseCoords(coordsRaw);
    if (!coords) {
      setError("Coordenadas inválidas — pega «lat, long» o un enlace de Google Maps");
      return;
    }
    setSending(true);
    setError(null);
    const err = await apiSend(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "location",
        location: { ...coords, ...(placeName.trim() ? { name: placeName.trim() } : {}) },
      }),
    });
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setPanel(null);
    setCoordsRaw("");
    setPlaceName("");
    onSent();
  }

  async function submitContact() {
    if (!contactName.trim() || contactPhone.trim().length < 5) {
      setError("El contacto necesita nombre y teléfono");
      return;
    }
    setSending(true);
    setError(null);
    const err = await apiSend(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "contacts",
        contacts: [{ name: contactName.trim(), phone: contactPhone.trim() }],
      }),
    });
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setPanel(null);
    setContactName("");
    setContactPhone("");
    onSent();
  }

  const canSubmit = file !== null || text.trim().length > 0;
  const canAttach = conversation.channel === "whatsapp" || conversation.channel === "messenger";
  // Reseñas de Google Business: solo texto (el reply público), sin adjuntos
  // ni mensajes estructurados.
  const isReview = conversation.channel === "google_business";
  // Chat del sitio: el visitante ve el hilo en su panel, que solo pinta texto;
  // una ubicación o una ficha de contacto llegarían como un hueco vacío.
  const isWebchat = conversation.channel === "webchat";
  const canStructured = !isReview && !isWebchat;

  return (
    <div className="border-t bg-background px-[18px] pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3">
      {file && (
        <div className="mb-2.5 flex items-center gap-2.5 rounded-md border bg-subtle p-2.5">
          {filePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={filePreview}
              alt={file.name}
              className="h-14 w-14 rounded object-cover"
            />
          ) : (
            <FileText className="h-8 w-8 shrink-0 text-brand" strokeWidth={1.5} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-text-3">
              {formatBytes(file.size)} · el texto de abajo va como pie del adjunto
            </p>
          </div>
          <button
            onClick={() => pickFile(null)}
            aria-label="Quitar adjunto"
              className="flex min-h-11 min-w-11 items-center justify-center rounded text-text-3 hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}

      {panel === "location" && (
        <div className="mb-2.5 flex flex-wrap items-end gap-2 rounded-md border bg-subtle p-2.5">
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Coordenadas o enlace de Google Maps
            <input
              value={coordsRaw}
              onChange={(e) => setCoordsRaw(e.target.value)}
              placeholder="21.019, -101.257"
              className="mt-1 w-full rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </label>
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Nombre del lugar (opcional)
            <input
              value={placeName}
              onChange={(e) => setPlaceName(e.target.value)}
              placeholder="Oficina AISHIA"
              className="mt-1 w-full rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </label>
          <button
            onClick={() => void submitLocation()}
            disabled={sending}
            className="rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-brand-fg shadow-sm hover:bg-brand-hover disabled:opacity-40"
          >
            Enviar ubicación
          </button>
          <button
            onClick={() => setPanel(null)}
            aria-label="Cancelar"
            className="flex min-h-11 min-w-11 items-center justify-center rounded text-text-3 hover:bg-secondary"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}

      {panel === "contact" && (
        <div className="mb-2.5 flex flex-wrap items-end gap-2 rounded-md border bg-subtle p-2.5">
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Nombre
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Xavier Pérez"
              className="mt-1 w-full rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </label>
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Teléfono
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+52 462 123 4567"
              className="mt-1 w-full rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </label>
          <button
            onClick={() => void submitContact()}
            disabled={sending}
            className="rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-brand-fg shadow-sm hover:bg-brand-hover disabled:opacity-40"
          >
            Enviar contacto
          </button>
          <button
            onClick={() => setPanel(null)}
            aria-label="Cancelar"
            className="flex min-h-11 min-w-11 items-center justify-center rounded text-text-3 hover:bg-secondary"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}

      {/* Hoja inferior de adjuntos — solo celular. Mismo patrón que los
          diálogos del CRM: velo + panel pegado al piso con safe-area. */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-overlay sm:hidden"
          onClick={() => setSheetOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Adjuntar"
            className="w-full max-w-md rounded-t-2xl border-t border-border-strong bg-background pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 shadow-pop"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-border-strong" />
            {canAttach && (
              <button
                onClick={() => {
                  setSheetOpen(false);
                  fileRef.current?.click();
                }}
                className="flex w-full min-h-12 items-center gap-3 px-4 text-left text-sm hover:bg-secondary"
              >
                <Paperclip className="h-[18px] w-[18px] text-text-3" strokeWidth={1.7} />
                Archivo (imagen, video, audio, documento)
              </button>
            )}
            {canStructured && (
              <button
                onClick={() => {
                  setSheetOpen(false);
                  setPanel("location");
                }}
                className="flex w-full min-h-12 items-center gap-3 px-4 text-left text-sm hover:bg-secondary"
              >
                <MapPin className="h-[18px] w-[18px] text-text-3" strokeWidth={1.7} />
                Ubicación
              </button>
            )}
            {canStructured && (
              <button
                onClick={() => {
                  setSheetOpen(false);
                  setPanel("contact");
                }}
                className="flex w-full min-h-12 items-center gap-3 px-4 text-left text-sm hover:bg-secondary"
              >
                <UserRound className="h-[18px] w-[18px] text-text-3" strokeWidth={1.7} />
                Contacto
              </button>
            )}
            <button
              onClick={() => setSheetOpen(false)}
              className="mt-1 w-full min-h-12 border-t border-border-strong text-center text-sm font-semibold text-text-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* La caja de escritura en píldora, como la del mockup de la landing */}
      <div className="flex items-end gap-2 rounded-[23px] border border-border-strong bg-background py-1.5 pl-2 pr-1.5 shadow-sm transition-[border-color,box-shadow] focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            pickFile(e.target.files?.[0] ?? null);
            // Reinicia el input: si no, volver a elegir EL MISMO archivo no
            // dispara `change` (el valor no cambió) y el usuario creía que
            // el adjunto no se había seleccionado.
            e.target.value = "";
          }}
        />
        {/* Celular: un solo «+» que abre la hoja de adjuntos — los tres íconos
            en línea dejaban el campo de texto casi sin ancho. */}
        {(canAttach || canStructured) && (
          <button
            onClick={() => setSheetOpen(true)}
            aria-label="Adjuntar"
            aria-expanded={sheetOpen}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-text-3 transition-colors hover:bg-secondary hover:text-foreground sm:hidden"
          >
            <Plus className="h-5 w-5" strokeWidth={1.7} />
          </button>
        )}
        {/* Tablet y escritorio: los tres accesos directos en línea. */}
        <div className="hidden shrink-0 items-center gap-0.5 sm:flex">
          {canAttach && (
            <button
              onClick={() => fileRef.current?.click()}
              aria-label="Adjuntar archivo"
              title="Adjuntar imagen, video, audio o documento"
              className="flex min-h-11 min-w-11 items-center justify-center rounded text-text-3 transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </button>
          )}
          {canStructured && (
            <button
              onClick={() => setPanel(panel === "location" ? null : "location")}
              aria-label="Enviar ubicación"
              title="Enviar ubicación"
              className={cn(
                "flex min-h-11 min-w-11 items-center justify-center rounded text-text-3 transition-colors hover:bg-secondary hover:text-foreground",
                panel === "location" && "bg-secondary text-brand"
              )}
            >
              <MapPin className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </button>
          )}
          {canStructured && (
            <button
              onClick={() => setPanel(panel === "contact" ? null : "contact")}
              aria-label="Compartir contacto"
              title="Compartir contacto"
              className={cn(
                "flex min-h-11 min-w-11 items-center justify-center rounded text-text-3 transition-colors hover:bg-secondary hover:text-foreground",
                panel === "contact" && "bg-secondary text-brand"
              )}
            >
              <UserRound className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </button>
          )}
        </div>
        <textarea
          ref={taRef}
          placeholder={
            file
              ? "Pie del adjunto (opcional)…"
              : isReview
                ? "Escribe la respuesta pública del negocio (máx. 4096 caracteres)…"
                : isWebchat
                  ? "Responde en el chat del sitio…"
                  : "Escribe una respuesta…"
          }
          value={text}
          rows={1}
          enterKeyHint="send"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          onFocus={(event) => {
            const textarea = event.currentTarget;
            window.setTimeout(() => textarea.scrollIntoView({ block: "nearest" }), 120);
          }}
          onChange={(e) => {
            setText(e.target.value);
            autogrow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          className="max-h-[120px] min-w-0 flex-1 resize-none self-center bg-transparent py-1 text-sm leading-relaxed outline-none placeholder:text-text-3"
        />
        <button
          onClick={() => void submit()}
          disabled={sending || !canSubmit}
          aria-label="Enviar"
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg transition-[opacity,background-color] hover:bg-brand-hover",
            (sending || !canSubmit) && "opacity-40"
          )}
        >
          <Send className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        {error ? <p className="text-xs text-destructive">{error}</p> : <span />}
        <p className="font-mono text-[10.5px] tracking-[0.04em] text-text-3">
          {conversation.humanAgentMode
            ? "Fuera de 24 h · respuesta con etiqueta de agente humano"
            : conversation.windowRemainingMs > 0
              ? `Ventana abierta · quedan ${formatRemaining(conversation.windowRemainingMs)}`
              : conversation.channel === "google_business" || conversation.channel === "comments"
                ? "Respuesta pública · sin ventana de mensajería"
                : conversation.channel === "webchat"
                  ? "Chat del sitio · sin ventana de mensajería"
                  : conversation.windowOpen
                  ? "Ventana abierta"
                  : conversation.channel === "tiktok"
                    ? "Ventana de TikTok cerrada · se requieren mensajes recientes del cliente"
                    : conversation.channel === "whatsapp"
                      ? "Ventana de WhatsApp cerrada · espera un nuevo mensaje del cliente"
                      : "Ventana cerrada · el envío depende de las reglas de la plataforma"}
        </p>
      </div>
    </div>
  );
}
