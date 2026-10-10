"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Clock3, MessageSquareText, Pause, Play, RefreshCw, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MEDIUM_LABELS, SOCIAL_LABELS } from "@/lib/contact-medium";

type Stage = { id: string; name: string; kind: string };
type Campaign = {
  id: string;
  name: string;
  status: string;
  recipientCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
};
type Preview = { total: number; queued: number; skipped: number; skippedByReason: Record<string, number> };

const MEDIUMS = ["red_social", "llamada", "correo", "presencial", "otro"] as const;
const SOCIALS = ["whatsapp", "instagram", "facebook", "tiktok", "x", "linkedin", "youtube", "otra"] as const;

const statusLabels: Record<string, string> = {
  draft: "Borrador",
  sending: "Enviando",
  paused: "Pausada",
  completed: "Finalizada",
};

function makeFilters(input: {
  stageId: string;
  medium: string;
  mediumDetail: string;
  noteEnabled: boolean;
  noteText: string;
  noteDays: number;
}) {
  return {
    ...(input.stageId ? { stageId: input.stageId } : {}),
    ...(input.medium ? { medium: input.medium } : {}),
    ...(input.medium === "red_social" && input.mediumDetail ? { mediumDetail: input.mediumDetail } : {}),
    ...(input.noteEnabled ? {
      noteDays: input.noteDays,
      ...(input.noteText.trim() ? { noteText: input.noteText.trim() } : {}),
    } : {}),
  };
}

export function BroadcastsClient() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState("");
  const [messageText, setMessageText] = useState("");
  const [stageId, setStageId] = useState("");
  const [medium, setMedium] = useState("");
  const [mediumDetail, setMediumDetail] = useState("");
  const [noteEnabled, setNoteEnabled] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteDays, setNoteDays] = useState(30);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filters = useMemo(() => makeFilters({ stageId, medium, mediumDetail, noteEnabled, noteText, noteDays }), [
    stageId, medium, mediumDetail, noteEnabled, noteText, noteDays,
  ]);

  const refresh = useCallback(async () => {
    const [campaignResponse, stageResponse] = await Promise.all([
      fetch("/api/broadcasts", { cache: "no-store" }),
      fetch("/api/pipeline/stages", { cache: "no-store" }),
    ]);
    if (campaignResponse.ok) setCampaigns((await campaignResponse.json()).campaigns ?? []);
    if (stageResponse.ok) setStages((await stageResponse.json()).stages ?? []);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const sending = campaigns.some((campaign) => campaign.status === "sending");
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [sending, refresh]);

  async function requestJson(url: string, init: RequestInit) {
    const response = await fetch(url, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message ?? data?.message ?? "No se pudo completar la solicitud");
    return data;
  }

  async function previewAudience() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await requestJson("/api/broadcasts/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(filters),
      });
      setPreview(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo calcular el segmento");
    } finally { setBusy(false); }
  }

  async function createCampaign() {
    if (!name.trim() || !messageText.trim()) {
      setError("Escribe un nombre y el mensaje de la campaña.");
      return;
    }
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await requestJson("/api/broadcasts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, messageText, filters }),
      });
      setNotice(`Campaña guardada con ${result.campaign.recipientCount} contactos en su lista.`);
      setName(""); setMessageText(""); setPreview(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la campaña");
    } finally { setBusy(false); }
  }

  async function setCampaignState(campaign: Campaign, action: "start" | "pause") {
    setError(null); setNotice(null);
    try {
      await requestJson(`/api/broadcasts/${campaign.id}/${action}`, { method: "POST" });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar el estado de la campaña");
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="kicker">Contactos segmentados</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Envíos masivos</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Crea campañas persistentes usando pipeline, red social y notas recientes. Cada campaña conserva su lista y resultados.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void refresh()} aria-label="Actualizar campañas">
          <RefreshCw className="mr-2 h-4 w-4" /> Actualizar
        </Button>
      </header>

      {(error || notice) && (
        <div role={error ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${error ? "border-red-500/30 bg-red-500/5 text-red-700" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700"}`}>
          {error ?? notice}
        </div>
      )}

      <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-tint text-brand-text"><Send className="h-4 w-4" /></span>
          <div><h2 className="font-semibold">Nueva campaña de WhatsApp</h2><p className="text-xs text-muted-foreground">El envío libre solo se realiza dentro de la ventana de atención.</p></div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div className="space-y-4">
            <label className="block space-y-1.5 text-sm font-medium">
              Nombre de campaña
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} placeholder="Seguimiento octubre" />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Mensaje
              <Textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} maxLength={4000} rows={5} placeholder="Escribe el mensaje que recibirán los contactos elegibles…" />
            </label>
          </div>

          <div className="space-y-3 rounded-lg border bg-subtle/50 p-4">
            <h3 className="text-sm font-semibold">Segmentar contactos</h3>
            <label className="block space-y-1 text-xs font-medium text-muted-foreground">
              Etapa del pipeline
              <select className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" value={stageId} onChange={(event) => { setStageId(event.target.value); setPreview(null); }}>
                <option value="">Todas las etapas</option>
                {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-xs font-medium text-muted-foreground">
              Medio de contacto
              <select className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" value={medium} onChange={(event) => { setMedium(event.target.value); setMediumDetail(""); setPreview(null); }}>
                <option value="">Todos los medios</option>
                {MEDIUMS.map((value) => <option key={value} value={value}>{MEDIUM_LABELS[value]}</option>)}
              </select>
            </label>
            {medium === "red_social" && (
              <label className="block space-y-1 text-xs font-medium text-muted-foreground">
                Red social
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" value={mediumDetail} onChange={(event) => { setMediumDetail(event.target.value); setPreview(null); }}>
                  <option value="">Todas las redes</option>
                  {SOCIALS.map((value) => <option key={value} value={value}>{SOCIAL_LABELS[value]}</option>)}
                </select>
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={noteEnabled} onChange={(event) => { setNoteEnabled(event.target.checked); setPreview(null); }} />
              Filtrar por notas recientes
            </label>
            {noteEnabled && (
              <div className="grid grid-cols-[1fr_110px] gap-2">
                <Input value={noteText} onChange={(event) => { setNoteText(event.target.value); setPreview(null); }} maxLength={160} placeholder="Texto de la última nota (opcional)" aria-label="Buscar en la última nota" />
                <Input type="number" min={1} max={365} value={noteDays} onChange={(event) => { setNoteDays(Math.min(365, Math.max(1, Number(event.target.value) || 1))); setPreview(null); }} aria-label="Días de antigüedad de las notas" />
              </div>
            )}
            <div className="flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
              <Clock3 className="h-4 w-4 shrink-0" /> Solo se incluyen contactos activos con conversación elegible.
            </div>
          </div>
        </div>

        {preview && (
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-background px-4 py-3 text-sm">
            <span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" /> {preview.total} en el segmento</span>
            <span className="text-emerald-700">{preview.queued} elegibles</span>
            <span className="inline-flex items-center gap-1.5 text-amber-700"><AlertCircle className="h-4 w-4" /> {preview.skipped} se omitirán</span>
            {Object.entries(preview.skippedByReason).map(([reason, count]) => <span key={reason} className="text-xs text-muted-foreground">{reason === "window_closed" ? "Fuera de ventana" : "Sin conversación WhatsApp"}: {count}</span>)}
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => void previewAudience()} disabled={busy}>
            <Users className="mr-2 h-4 w-4" /> {busy ? "Calculando…" : "Previsualizar segmento"}
          </Button>
          <Button onClick={() => void createCampaign()} disabled={busy || !name.trim() || !messageText.trim()}>
            <MessageSquareText className="mr-2 h-4 w-4" /> Guardar campaña
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Campañas guardadas</h2>
          <span className="text-xs text-muted-foreground">La lista de destinatarios queda como instantánea.</span>
        </div>
        {campaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Todavía no hay campañas.</div>
        ) : campaigns.map((campaign) => (
          <article key={campaign.id} className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{campaign.name}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${campaign.status === "sending" ? "border-blue-500/30 bg-blue-500/10 text-blue-700" : "border-border bg-subtle text-muted-foreground"}`}>{statusLabels[campaign.status] ?? campaign.status}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{campaign.recipientCount} contactos · {new Date(campaign.createdAt).toLocaleString("es-MX")}</p>
              </div>
              <div className="flex gap-2">
                {(campaign.status === "draft" || campaign.status === "paused") && <Button size="sm" onClick={() => void setCampaignState(campaign, "start")}><Play className="mr-1.5 h-3.5 w-3.5" /> {campaign.status === "paused" ? "Reanudar" : "Iniciar"}</Button>}
                {campaign.status === "sending" && <Button size="sm" variant="secondary" onClick={() => void setCampaignState(campaign, "pause")}><Pause className="mr-1.5 h-3.5 w-3.5" /> Pausar</Button>}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Metric label="Enviados" value={campaign.sentCount} />
              <Metric label="Entregados" value={campaign.deliveredCount} />
              <Metric label="Leídos" value={campaign.readCount} />
              <Metric label="Fallidos" value={campaign.failedCount} />
              <Metric label="Omitidos" value={campaign.skippedCount} />
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-subtle/70 px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p></div>;
}
