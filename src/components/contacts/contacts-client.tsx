"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  Download,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  Search,
  Upload,
  UserPlus,
  X,
  DollarSign,
} from "lucide-react";
import type { ContactDto } from "@/lib/types";
import { formatPhone } from "@/lib/utils";
import { formatMoneyCents, parseMoneyToCents } from "@/lib/money";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { mediumLabel, normalizeMedium } from "@/lib/contact-medium";
import { SOURCE_LABELS, SOURCE_VALUES } from "@/server/contact-source";
import { MediumPicker } from "./medium-picker";
import { priorityRank } from "@/server/leads/priority";
import { PriorityBadge } from "@/components/pipeline/priority-picker";
import { NewContactDialog } from "./new-contact-dialog";
import { ImportContactsDialog } from "./import-contacts-dialog";
import { ScheduleMessageDialog } from "./schedule-message-dialog";

const STAGE_TONE: Record<string, string> = {
  Customer: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Cliente: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

function stageTone(name: string | null): string {
  if (!name) return "border-border bg-subtle text-text-2";
  return STAGE_TONE[name] ?? "border-border bg-subtle text-text-2";
}

export function ContactsClient() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  /**
   * Contactos es la cartera de clientes: solo se listan los tratos ganados.
   * El embudo (prospectos en cualquier etapa) vive en el Pipeline, que es la
   * pantalla donde se mueven, y ya no hay filtro de etapa aquí.
   */
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ContactDto | null>(null);
  const [viewing, setViewing] = useState<ContactDto | null>(null);
  const [scheduling, setScheduling] = useState<ContactDto | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [importando, setImportando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const typed = inputRef.current?.value ?? "";
    if (typed) setQuery(typed);
  }, []);

  const refetch = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    params.set("won", "1");
    if (showArchived) params.set("archived", "true");
    const res = await fetch(`/api/contacts?${params}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { contacts: ContactDto[] };
    setContacts(
      [...data.contacts].sort(
        (a, b) => priorityRank(a.priority ?? null) - priorityRank(b.priority ?? null)
      )
    );
  }, [query, showArchived]);

  useEffect(() => {
    const t = setTimeout(() => void refetch(), 250);
    return () => clearTimeout(t);
  }, [refetch]);

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/contacts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    void refetch();
  }

  async function deleteContact(id: string, name: string) {
    if (!confirm(`¿Eliminar contacto "${name}"? Esta accion no se puede deshacer.`)) return;
    await fetch(`/api/contacts/${id}`, { method: "DELETE" }).catch(() => null);
    void refetch();
  }

  // Cerrar menú al hacer click fuera
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-bold tracking-tight">Contactos</h2>
          <Button size="sm" onClick={() => setCreando(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Nuevo contacto
          </Button>
          <Button size="sm" variant="outline" onClick={() => setImportando(true)}>
            <Upload className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Importar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const params = new URLSearchParams();
              if (query.trim()) params.set("q", query.trim());
              params.set("won", "1");
              if (showArchived) params.set("archived", "true");
              window.open(`/api/contacts/export?${params}`, "_blank");
            }}
          >
            <Download className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Exportar
          </Button>
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
              aria-label="Buscar contacto"
              defaultValue=""
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-8 sm:w-72"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {contacts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            {query.trim() ? (
              <>
                <p className="text-sm font-medium">Sin resultados</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Nadie coincide con «{query.trim()}» entre los clientes.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">Aún no hay clientes</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Los contactos aparecen aquí cuando su trato llega a la etapa
                  «Cliente» del Pipeline.
                </p>
              </>
            )}
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {contacts.map((c) => {
              const med = mediumLabel(c.medium, c.mediumDetail);
              const email = typeof c.ficha?.email === "string" ? c.ficha.email : null;
              const channelLabel = CHANNEL_LABEL[c.channel as Channel] ?? c.channel;
              const money = formatMoneyCents(c.amountCents, "MXN");
              return (
                <li
                  key={c.id}
                  className="group relative flex flex-col rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
                >
                  {/* Menú de acciones */}
                  <div className="absolute right-2 top-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      aria-label="Acciones"
                      onClick={() => setMenuOpen(menuOpen === c.id ? null : c.id)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {menuOpen === c.id && (
                      <div className="absolute right-0 top-8 z-20 w-44 rounded-md border bg-card py-1 shadow-lg">
                        <button
                          type="button"
                          onClick={() => { setMenuOpen(null); setEditing(c); }}
                          className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => { setMenuOpen(null); setScheduling(c); }}
                          className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                        >
                          Programar mensaje
                        </button>
                        <Link href={`/inbox?contact=${c.id}`} className="block px-3 py-1.5 text-sm hover:bg-accent">
                          Abrir conversación
                        </Link>
                        <button
                          type="button"
                          onClick={() => { setMenuOpen(null); void patch(c.id, { archived: !c.archivedAt }); }}
                          className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                        >
                          {c.archivedAt ? "Desarchivar" : "Archivar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setMenuOpen(null); void deleteContact(c.id, c.name); }}
                          className="w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-accent"
                        >
                          Eliminar
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Avatar + nombre + etapa */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setViewing(c)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setViewing(c);
                      }
                    }}
                    className="flex cursor-pointer flex-col items-center gap-2 pb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ContactAvatar name={c.name} seed={c.id} size="lg" />
                    <h3 className="w-full truncate text-center text-sm font-semibold" title={c.name}>
                      {c.name}
                    </h3>
                    {c.stageName && (
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${stageTone(c.stageName)}`}>
                        {c.stageName}
                      </span>
                    )}
                    {c.priority && <PriorityBadge value={c.priority} />}
                  </div>

                  {/* Datos de contacto */}
                  <div className="space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{c.phone ? formatPhone(c.phone) : "—"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{email ?? "—"}</span>
                    </div>
                    {money && (
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-3.5 w-3.5 shrink-0" />
                        <span className="font-medium text-foreground">{money}</span>
                      </div>
                    )}
                  </div>

                  {/* Footer: canal + medio + fuente + acciones rápidas */}
                  <div className="mt-3 flex items-center justify-between border-t pt-3">
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="secondary" className="text-[10px]">{channelLabel}</Badge>
                      {med && <Badge variant="outline" className="text-[10px]">{med}</Badge>}
                      {c.source?.source === "capturada" && (
                        <Badge variant="outline" className="text-[10px]">
                          {SOURCE_LABELS[c.source.value]}
                        </Badge>
                      )}
                      {c.archivedAt && <Badge variant="secondary" className="text-[10px]">Archivado</Badge>}
                    </div>
                    <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="Programar mensaje"
                        title="Programar mensaje"
                        onClick={() => setScheduling(c)}
                      >
                        <CalendarClock className="h-3.5 w-3.5" />
                      </Button>
                      <Link href={`/inbox?contact=${c.id}`}>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Abrir conversación">
                          <MessageSquareText className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editing && (
        <EditDialog
          contact={editing}
          onClose={() => setEditing(null)}
          onSave={async (patchBody) => {
            await patch(editing.id, patchBody);
            setEditing(null);
          }}
        />
      )}

      {viewing && (
        <ContactDetailDialog
          contact={viewing}
          onClose={() => setViewing(null)}
          onEdit={(contact) => { setViewing(null); setEditing(contact); }}
          onSchedule={(contact) => { setViewing(null); setScheduling(contact); }}
        />
      )}

      {scheduling && (
        <ScheduleMessageDialog
          contact={scheduling}
          onClose={() => setScheduling(null)}
        />
      )}

      {importando && (
        <ImportContactsDialog
          onClose={() => setImportando(false)}
          onImported={() => void refetch()}
        />
      )}

      {creando && (
        <NewContactDialog
          onClose={() => setCreando(false)}
          onCreated={() => {
            setCreando(false);
            void refetch();
          }}
          onOpenExisting={(contactId) => {
            setCreando(false);
            router.push(`/inbox?contact=${contactId}`);
          }}
        />
      )}
    </div>
  );
}

type ContactDetailResponse = {
  contact: ContactDto;
  stage: { id: string; name: string; kind: string; position: number } | null;
  lead: { id: string } | null;
};

function ContactDetailDialog({
  contact: initial,
  onClose,
  onEdit,
  onSchedule,
}: {
  contact: ContactDto;
  onClose: () => void;
  onEdit: (contact: ContactDto) => void;
  onSchedule: (contact: ContactDto) => void;
}) {
  const [detail, setDetail] = useState<ContactDetailResponse | null>(null);
  const [error, setError] = useState("");
  const [optInAt, setOptInAt] = useState<string | null>(initial.waMarketingOptInAt ?? null);
  const [optInBusy, setOptInBusy] = useState(false);
  const [optInError, setOptInError] = useState("");
  useEffect(() => {
    let active = true;
    fetch(`/api/contacts/${initial.id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("No se pudo cargar la ficha del contacto.");
        return await res.json() as ContactDetailResponse;
      })
      .then((data) => { if (active) setDetail(data); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Error de conexión."); });
    return () => { active = false; };
  }, [initial.id]);
  useEffect(() => {
    if (detail) setOptInAt(detail.contact.waMarketingOptInAt ?? null);
  }, [detail]);

  const contact = detail?.contact ?? initial;

  async function toggleOptIn(next: boolean) {
    setOptInBusy(true);
    setOptInError("");
    const response = await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ waMarketingOptIn: next }),
    }).catch(() => null);
    setOptInBusy(false);
    if (!response?.ok) {
      const data = await response?.json().catch(() => null) as { error?: { message?: string } } | null;
      setOptInError(data?.error?.message ?? "No se pudo actualizar el consentimiento.");
      return;
    }
    setOptInAt(next ? new Date().toISOString() : null);
  }
  const ficha = contact.ficha ?? {};
  const fichaEntries = Object.entries(ficha).filter(([key]) => key !== "email");
  const email = typeof ficha.email === "string" ? ficha.email : null;
  const medium = mediumLabel(contact.medium, contact.mediumDetail);
  const channelLabel = CHANNEL_LABEL[contact.channel as Channel] ?? contact.channel;
  const money = formatMoneyCents(contact.amountCents, "MXN");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Ficha de ${contact.name}`}
        className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-xl border bg-card p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mb-5 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ContactAvatar name={contact.name} seed={contact.id} size="lg" />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{contact.name}</h2>
              <p className="text-sm text-muted-foreground">Ficha del contacto</p>
            </div>
          </div>
          <button type="button" aria-label="Cerrar ficha" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </header>

        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
        {!detail && !error && <p className="mb-3 text-sm text-muted-foreground">Cargando datos completos…</p>}

        <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
          <DetailField label="Teléfono" value={contact.phone ? formatPhone(contact.phone) : null} />
          <DetailField label="Correo" value={email} />
          <DetailField label="Etapa" value={detail?.stage?.name ?? contact.stageName} />
          <DetailField label="Canal" value={channelLabel} />
          <DetailField label="Medio de contacto" value={medium} />
          <DetailField label="Monto" value={money} />
          <DetailField label="Fuente" value={contact.source ? `${SOURCE_LABELS[contact.source.value]} · ${contact.source.source === "capturada" ? "capturada" : "deducida"}` : null} />
          {contact.source?.value === "compra" && (
            <>
              <DetailField label="Producto comprado" value={contact.purchaseProduct ?? null} />
              <DetailField
                label="Fecha de compra"
                value={contact.purchaseDate ? contact.purchaseDate.slice(0, 10) : null}
              />
              <DetailField
                label="Monto de compra"
                value={
                  contact.purchaseAmountCents != null
                    ? formatMoneyCents(contact.purchaseAmountCents, "MXN")
                    : null
                }
              />
            </>
          )}
          <DetailField label="Prioridad" value={contact.priority ?? null} />
          <DetailField label="Estado" value={contact.archivedAt ? "Archivado" : "Activo"} />
        </dl>

        <div className="mt-4 rounded-lg border p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                Consentimiento de WhatsApp
              </h3>
              <p className="mt-1 text-sm">
                {optInAt
                  ? `Autorizó promociones por WhatsApp el ${new Date(optInAt).toLocaleDateString("es-MX")}${contact.waMarketingOptInSource ? ` · ${contact.waMarketingOptInSource}` : ""}.`
                  : "Sin autorización para promociones por WhatsApp."}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                Se exige para plantillas de marketing fuera de la ventana de
                24 h. Regístralo solo si el contacto lo autorizó.
              </p>
            </div>
            <Button
              variant={optInAt ? "outline" : "secondary"}
              size="sm"
              disabled={optInBusy}
              onClick={() => void toggleOptIn(!optInAt)}
            >
              {optInBusy ? "Guardando…" : optInAt ? "Revocar" : "Registrar autorización"}
            </Button>
          </div>
          {optInError && <p role="alert" className="mt-2 text-xs text-destructive">{optInError}</p>}
        </div>

        {contact.notes && (
          <div className="mt-4 rounded-lg border p-3">
            <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Notas</h3>
            <p className="whitespace-pre-wrap text-sm">{contact.notes}</p>
          </div>
        )}
        {fichaEntries.length > 0 && (
          <div className="mt-4 rounded-lg border p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Información adicional</h3>
            <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
              {fichaEntries.map(([key, value]) => (
                <DetailField key={key} label={key} value={String(value)} />
              ))}
            </dl>
          </div>
        )}

        <footer className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => onSchedule(contact)}>
            <CalendarClock className="mr-2 h-4 w-4" />Programar mensaje
          </Button>
          <Link href={`/inbox?contact=${contact.id}`}>
            <Button variant="outline"><MessageSquareText className="mr-2 h-4 w-4" />Abrir conversación</Button>
          </Link>
          <Button onClick={() => onEdit(contact)}>Editar contacto</Button>
        </footer>
      </section>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{value || "Sin capturar"}</dd>
    </div>
  );
}

function EditDialog({
  contact,
  onClose,
  onSave,
}: {
  contact: ContactDto;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(contact.name);
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [email, setEmail] = useState(((contact.ficha as Record<string, unknown>)?.email as string) ?? "");
  const [interests, setInterests] = useState(((contact.ficha as Record<string, unknown>)?.interests as string) ?? "");
  const originalEmail = ((contact.ficha as Record<string, unknown>)?.email as string) ?? "";
  const originalInterests = ((contact.ficha as Record<string, unknown>)?.interests as string) ?? "";
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [medium, setMedium] = useState(contact.medium ?? "");
  const [mediumDetail, setMediumDetail] = useState(contact.mediumDetail ?? "");
  // La fuente deducida ("desconocida") no se puede elegir: o la captura el
  // dueño o sigue sin identificar.
  const [source, setSource] = useState(
    contact.source?.source === "capturada" ? contact.source.value : ""
  );
  const [purchaseProduct, setPurchaseProduct] = useState(contact.purchaseProduct ?? "");
  const [purchaseDate, setPurchaseDate] = useState(
    contact.purchaseDate ? contact.purchaseDate.slice(0, 10) : ""
  );
  const [purchaseAmount, setPurchaseAmount] = useState(
    contact.purchaseAmountCents != null ? (contact.purchaseAmountCents / 100).toFixed(2) : ""
  );
  const compraParse = purchaseAmount.trim() ? parseMoneyToCents(purchaseAmount) : null;
  const compraInvalida = purchaseAmount.trim().length > 0 && compraParse === null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-overlay p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="my-auto max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-lg border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-semibold">Editar contacto</h3>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-name">
              Nombre
            </label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-phone">
              Teléfono
            </label>
            <Input
              id="edit-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="521XXXXXXXXXX"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-email">
              Correo electrónico
            </label>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
            />
          </div>
          <MediumPicker
            idPrefix="edit"
            medium={medium}
            mediumDetail={mediumDetail}
            onChange={(next) => {
              setMedium(next.medium);
              setMediumDetail(next.mediumDetail);
            }}
          />
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-source">
              Fuente
            </label>
            <select
              id="edit-source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="">Sin identificar</option>
              {SOURCE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {SOURCE_LABELS[v]}
                </option>
              ))}
            </select>
          </div>
          {source === "compra" && (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Detalle de la compra
              </p>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="edit-purchase-product">
                  Producto
                </label>
                <Input
                  id="edit-purchase-product"
                  value={purchaseProduct}
                  onChange={(e) => setPurchaseProduct(e.target.value)}
                  placeholder="Ej: Cámara de seguridad x4"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="edit-purchase-date">
                    Fecha
                  </label>
                  <Input
                    id="edit-purchase-date"
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="edit-purchase-amount">
                    Monto (MXN)
                  </label>
                  <Input
                    id="edit-purchase-amount"
                    inputMode="decimal"
                    value={purchaseAmount}
                    onChange={(e) => setPurchaseAmount(e.target.value)}
                    placeholder="12,500.00"
                  />
                </div>
              </div>
              {compraInvalida && (
                <p className="text-xs text-danger-text">
                  No reconozco ese monto. Escríbelo como 12500 o 12,500.00
                </p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-interests">
              Intereses / Servicios de interés
            </label>
            <Textarea
              id="edit-interests"
              rows={2}
              value={interests}
              onChange={(e) => setInterests(e.target.value)}
              placeholder="Ej: Interesado en productos premium, servicio de entrega..."
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-notes">
              Notas
            </label>
            <Textarea
              id="edit-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={
              !name.trim() ||
              !normalizeMedium({ medium, mediumDetail }).ok ||
              compraInvalida
            }
            onClick={() => {
              const patch: Record<string, unknown> = { name: name.trim(), notes };
              if (phone !== (contact.phone ?? "")) patch.phone = phone || null;
              patch.medium = medium || null;
              patch.mediumDetail = medium === "red_social" ? mediumDetail || null : null;
              patch.source = source || null;
              if (source === "compra") {
                patch.purchaseProduct = purchaseProduct.trim() || null;
                patch.purchaseDate = purchaseDate || null;
                patch.purchaseAmountCents = compraParse;
              }
              const ficha: Record<string, unknown> = {};
              if (email !== originalEmail) ficha.email = email || null;
              if (interests !== originalInterests) ficha.interests = interests || null;
              if (Object.keys(ficha).length > 0) patch.ficha = ficha;
              void onSave(patch);
            }}
          >
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
