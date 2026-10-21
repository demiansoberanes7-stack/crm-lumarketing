"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MessageSquareText, Phone, Search, Users } from "lucide-react";
import type { ProspectDto } from "@/lib/types";
import { CHANNEL_LABEL, CHANNEL_ORDER } from "@/lib/channels";
import { formatPhone } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/**
 * Prospectos: todo el que escribió primero, ordenado por su último mensaje.
 *
 * La pantalla no da de alta nada —eso lo hace la ingesta— y por eso no tiene
 * botón de "nuevo": su trabajo es mostrar, en un solo vistazo, quién ya habló,
 * por dónde, cuántas veces y si dejó su número. El teléfono que el cliente
 * escribe en el chat se captura solo (`server/inbox/phone-capture.ts`), así que
 * el filtro «Sin teléfono» es la lista real de a quién hay que pedirle el dato.
 */

type PhoneFilter = "todos" | "falta" | "tiene";

function sinceLabel(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 60) return `hace ${Math.max(minutes, 1)} min`;
  if (minutes < 60 * 24) return `hace ${Math.round(minutes / 60)} h`;
  const days = Math.round(minutes / (60 * 24));
  if (days < 30) return `hace ${days} d`;
  return date.toLocaleDateString("es-MX");
}

function preview(text: string | null): string {
  const oneLine = text?.replace(/\s+/g, " ").trim() ?? "";
  if (!oneLine) return "Sin mensaje de texto (audio, imagen o video).";
  return oneLine.length > 90 ? `${oneLine.slice(0, 90)}…` : oneLine;
}

export function ProspectsClient() {
  const [prospects, setProspects] = useState<ProspectDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<string>("");
  const [phone, setPhone] = useState<PhoneFilter>("todos");
  const [showArchived, setShowArchived] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // La lista llega filtrada de la BD; el orden de `query` no se recomputa aquí
  // para que el corte de 200 y el filtro hablen del mismo criterio.
  const refetch = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (channel) params.set("channel", channel);
    if (phone !== "todos") params.set("phone", phone);
    if (showArchived) params.set("archived", "true");
    const res = await fetch(`/api/prospects?${params}`).catch(() => null);
    if (!res?.ok) {
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { prospects: ProspectDto[] };
    setProspects(data.prospects ?? []);
    setLoading(false);
  }, [query, channel, phone, showArchived]);

  useEffect(() => {
    const t = setTimeout(() => void refetch(), 250);
    return () => clearTimeout(t);
  }, [refetch]);

  useEffect(() => {
    const typed = inputRef.current?.value ?? "";
    if (typed) setQuery(typed);
  }, []);

  const summary = useMemo(() => {
    const conTelefono = prospects.filter((p) => p.phone).length;
    return { total: prospects.length, conTelefono, sinTelefono: prospects.length - conTelefono };
  }, [prospects]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-bold tracking-tight">Prospectos</h2>
          <Badge variant="secondary">{summary.total}</Badge>
          <span className="text-xs text-muted-foreground">
            {summary.conTelefono} con teléfono · {summary.sinTelefono} sin teléfono
          </span>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-primary"
            />
            Ver archivados
          </label>
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Buscar por nombre o teléfono…"
              aria-label="Buscar prospecto"
              defaultValue=""
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-8 sm:w-72"
            />
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b bg-subtle/40 px-4 py-2.5 text-xs sm:px-6">
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Canal
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="rounded-md border bg-card px-2 py-1 text-xs text-foreground"
            aria-label="Filtrar por canal"
          >
            <option value="">Todos</option>
            {CHANNEL_ORDER.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Teléfono
          <select
            value={phone}
            onChange={(e) => setPhone(e.target.value as PhoneFilter)}
            className="rounded-md border bg-card px-2 py-1 text-xs text-foreground"
            aria-label="Filtrar por teléfono"
          >
            <option value="todos">Todos</option>
            <option value="falta">Sin teléfono</option>
            <option value="tiene">Con teléfono</option>
          </select>
        </label>
        <p className="ml-auto hidden text-muted-foreground sm:block">
          El número que el cliente escribe en el chat se guarda solo.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando prospectos…</p>
        ) : prospects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Users className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
            <p className="text-sm font-medium">Aún no hay prospectos</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Aquí aparece automáticamente todo el que escriba por WhatsApp,
              Instagram, Messenger o TikTok. Si estabas buscando a alguien con
              un filtro puesto, quítalo: puede que sí exista y no coincida.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {prospects.map((p) => (
              <li
                key={p.contactId}
                className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <ContactAvatar name={p.name} seed={p.contactId} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {p.name}
                      {p.archivedAt ? (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          (archivado)
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="rounded-full border px-1.5 py-0.5">{p.channelLabel}</span>
                      {p.stageName ? (
                        <span className="rounded-full border px-1.5 py-0.5">{p.stageName}</span>
                      ) : null}
                    </p>
                  </div>
                </div>

                <div className="text-sm">
                  {p.phone ? (
                    <a
                      href={`tel:+${p.phone}`}
                      className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                    >
                      <Phone className="h-3.5 w-3.5" strokeWidth={1.8} />
                      {formatPhone(p.phone)}
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
                      Sin teléfono: pídeselo en el chat
                    </span>
                  )}
                </div>

                <p className="line-clamp-2 rounded-md bg-subtle px-2.5 py-2 text-xs text-text-2">
                  {preview(p.lastInboundText)}
                </p>

                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {p.inboundCount} {p.inboundCount === 1 ? "mensaje" : "mensajes"} · primer
                    contacto {sinceLabel(p.firstInboundAt)}
                  </span>
                  <span>último {sinceLabel(p.lastInboundAt)}</span>
                </div>

                <Link
                  href={`/inbox?contact=${p.contactId}`}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                >
                  <MessageSquareText className="h-3.5 w-3.5" strokeWidth={1.8} />
                  Abrir en bandeja
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
