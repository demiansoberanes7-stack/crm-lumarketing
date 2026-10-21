"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Clock3, MessageSquareText, Pause, Play, RefreshCw, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  TEMPLATE_CATEGORY_LABEL,
  WhatsappTemplatePicker,
  templateReady,
  templateRequiresOptIn,
  useWhatsappTemplates,
  type WhatsappTemplateDto,
} from "@/components/whatsapp/template-picker";
import { MEDIUM_LABELS, SOCIAL_LABELS } from "@/lib/contact-medium";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";

type Stage = { id: string; name: string; kind: string };
type Campaign = {
  id: string;
  name: string;
  channel: string;
  status: string;
  recipientCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  skippedCount: number;
  /** Pendientes de que el cliente reabra la ventana. */
  waitingCount?: number;
  templateName: string | null;
  templateCategory: string | null;
  scheduledAt: string;
  createdAt: string;
};
type Preview = {
  total: number;
  queued: number;
  waiting: number;
  skipped: number;
  skippedByReason: Record<string, number>;
};
type ChannelOption = { id: string; label: string; enabled: boolean; connected: boolean; status: string };

const MEDIUMS = ["red_social", "llamada", "correo", "presencial", "otro"] as const;
const SOCIALS = ["whatsapp", "instagram", "facebook", "tiktok", "x", "linkedin", "youtube", "otra"] as const;

/** Un canal de chat por campaña: los mismos cuatro que acepta el schema. */
const CAMPAIGN_CHANNELS = ["whatsapp", "instagram", "messenger", "tiktok"] as const;

const statusLabels: Record<string, string> = {
  draft: "Borrador",
  sending: "Enviando",
  paused: "Pausada",
  completed: "Finalizada",
};

/** Etiquetas legibles de por qué un contacto quedó fuera del envío. */
const skipLabels: Record<string, string> = {
  window_closed: "Fuera de ventana",
  no_whatsapp_conversation: "Sin conversación WhatsApp",
  no_instagram_conversation: "Sin conversación Instagram",
  no_messenger_conversation: "Sin conversación Messenger",
  no_tiktok_conversation: "Sin conversación TikTok",
};

function makeFilters(input: {
  stageId: string;
  medium: string;
  mediumDetail: string;
  noteEnabled: boolean;
  noteText: string;
  noteDays: number;
  optInOnly: boolean;
}) {
  return {
    ...(input.stageId ? { stageId: input.stageId } : {}),
    ...(input.medium ? { medium: input.medium } : {}),
    ...(input.medium === "red_social" && input.mediumDetail ? { mediumDetail: input.mediumDetail } : {}),
    ...(input.noteEnabled ? {
      noteDays: input.noteDays,
      ...(input.noteText.trim() ? { noteText: input.noteText.trim() } : {}),
    } : {}),
    ...(input.optInOnly ? { optInOnly: true } : {}),
  };
}

export function BroadcastsClient() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([]);
  const [channel, setChannel] = useState<string>("whatsapp");
  const [name, setName] = useState("");
  const [messageText, setMessageText] = useState("");
  const [stageId, setStageId] = useState("");
  const [medium, setMedium] = useState("");
  const [mediumDetail, setMediumDetail] = useState("");
  const [noteEnabled, setNoteEnabled] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteDays, setNoteDays] = useState(30);
  const [useTemplate, setUseTemplate] = useState(false);
  const [template, setTemplate] = useState<WhatsappTemplateDto | null>(null);
  const [templateParams, setTemplateParams] = useState<string[]>([]);
  const [templateHeaderMediaUrl, setTemplateHeaderMediaUrl] = useState("");
  const [optInOnly, setOptInOnly] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isWhatsapp = channel === "whatsapp";
  const templatesState = useWhatsappTemplates(isWhatsapp && useTemplate);
  const marketingTemplate = templateRequiresOptIn(template?.category);
  const effectiveOptInOnly = optInOnly || marketingTemplate;

  const filters = useMemo(
    () => makeFilters({
      stageId, medium, mediumDetail, noteEnabled, noteText, noteDays,
      optInOnly: effectiveOptInOnly,
    }),
    [stageId, medium, mediumDetail, noteEnabled, noteText, noteDays, effectiveOptInOnly]
  );

  function chooseTemplate(next: WhatsappTemplateDto | null) {
    setTemplate(next);
    setTemplateParams(next ? Array.from({ length: next.variableCount }, () => "") : []);
    setTemplateHeaderMediaUrl("");
    setPreview(null);
  }

  const refresh = useCallback(async () => {
    const [campaignResponse, stageResponse, channelResponse] = await Promise.all([
      fetch("/api/broadcasts", { cache: "no-store" }),
      fetch("/api/pipeline/stages", { cache: "no-store" }),
      fetch("/api/automations/channels", { cache: "no-store" }),
    ]);
    if (campaignResponse.ok) setCampaigns((await campaignResponse.json()).campaigns ?? []);
    if (stageResponse.ok) setStages((await stageResponse.json()).stages ?? []);
    if (channelResponse.ok) {
      const options = ((await channelResponse.json()).channels ?? []) as ChannelOption[];
      const chat = options.filter((option) =>
        (CAMPAIGN_CHANNELS as readonly string[]).includes(option.id)
      );
      setChannelOptions(chat);
      // Si el canal elegido ya no está conectado en esta instancia, cae al
      // primero que sí lo esté (WhatsApp primero por el orden del catálogo).
      setChannel((current) =>
        chat.some((option) => option.id === current && option.connected)
          ? current
          : chat.find((option) => option.connected)?.id ?? chat[0]?.id ?? "whatsapp"
      );
    }
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
        body: JSON.stringify({
          ...filters,
          channel,
          ...(template ? { templateName: template.name } : {}),
        }),
      });
      setPreview(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo calcular el segmento");
    } finally { setBusy(false); }
  }

  async function createCampaign() {
    if (!name.trim()) {
      setError("Escribe un nombre para la campaña.");
      return;
    }
    if (useTemplate && isWhatsapp) {
      if (!template) {
        setError("Elige una plantilla aprobada o desactiva el envío con plantilla.");
        return;
      }
      if (!templateReady(template, templateParams, templateHeaderMediaUrl)) {
        setError("Completa las variables de la plantilla y, si lleva encabezado, su enlace https.");
        return;
      }
    } else if (!messageText.trim()) {
      setError("Escribe el mensaje de la campaña o elige una plantilla aprobada.");
      return;
    }
    setBusy(true); setError(null); setNotice(null);
    try {
      const sendingTemplate = useTemplate && isWhatsapp ? template : null;
      const result = await requestJson("/api/broadcasts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          channel,
          filters,
          ...(sendingTemplate
            ? {
                templateName: sendingTemplate.name,
                templateLanguage: sendingTemplate.language,
                templateParams,
                templateCategory: sendingTemplate.category ?? undefined,
                ...(sendingTemplate.headerMediaRequired
                  ? { templateHeaderMediaUrl }
                  : {}),
              }
            : { messageText }),
        }),
      });
      const waiting = Number(result.campaign.waitingCount ?? 0);
      setNotice(
        `Campaña guardada con ${result.campaign.recipientCount} contactos en su lista.` +
          (waiting > 0
            ? ` ${waiting} esperarán a que el cliente vuelva a escribir para enviarse.`
            : "")
      );
      setName(""); setMessageText(""); setPreview(null);
      setUseTemplate(false); chooseTemplate(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la campaña");
    } finally { setBusy(false); }
  }

  const messageReady = useTemplate && isWhatsapp
    ? templateReady(template, templateParams, templateHeaderMediaUrl)
    : messageText.trim().length > 0;

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
    <div className="mx-auto h-full w-full max-w-6xl space-y-6 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="kicker">Contactos segmentados</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Envíos masivos</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Crea campañas persistentes usando pipeline, red social y notas recientes. En WhatsApp, fuera de la ventana de 24 h solo sale una plantilla aprobada (marketing exige opt-in). En Instagram, Messenger y TikTok el envío espera a que el cliente vuelva a escribir y sale en cuanto se abre la ventana.
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
          <div>
            <h2 className="font-semibold">Nueva campaña de {CHANNEL_LABEL[channel as Channel] ?? channel}</h2>
            <p className="text-xs text-muted-foreground">
              {isWhatsapp
                ? "Dentro de 24 h se envía texto libre. Fuera de la ventana, usa una plantilla aprobada; si es de marketing, la audiencia se limita a quienes dieron su opt-in."
                : "El texto libre solo sale dentro de la ventana de atención. Si está cerrada, la campaña espera al siguiente mensaje del cliente y se envía en cuanto se abre."}
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div className="space-y-4">
            <label className="block space-y-1.5 text-sm font-medium">
              Canal de la campaña
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                value={channel}
                onChange={(event) => {
                  const next = event.target.value;
                  setChannel(next);
                  setPreview(null);
                  if (next !== "whatsapp") {
                    setUseTemplate(false);
                    chooseTemplate(null);
                    setOptInOnly(false);
                  }
                }}
                aria-label="Canal de la campaña"
              >
                {channelOptions.length === 0 && <option value="whatsapp">WhatsApp</option>}
                {channelOptions.map((option) => (
                  <option key={option.id} value={option.id} disabled={!option.connected}>
                    {option.label}{option.connected ? "" : " — sin conectar"}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Nombre de campaña
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} placeholder="Seguimiento octubre" />
            </label>
            {isWhatsapp && (
              <label className="flex items-start gap-2 rounded-lg border bg-subtle px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={useTemplate}
                  onChange={(event) => {
                    setUseTemplate(event.target.checked);
                    if (!event.target.checked) chooseTemplate(null);
                  }}
                />
                <span>
                  <span className="font-medium">Enviar con plantilla aprobada</span>
                  <span className="block text-xs text-muted-foreground">
                    Única vía legal fuera de la ventana de 24 h de WhatsApp.
                  </span>
                </span>
              </label>
            )}
            {isWhatsapp && useTemplate ? (
              <WhatsappTemplatePicker
                templates={templatesState.templates}
                provider={templatesState.provider}
                loading={templatesState.loading}
                error={templatesState.error}
                onReload={templatesState.reload}
                selected={template}
                params={templateParams}
                onSelect={chooseTemplate}
                onParamsChange={setTemplateParams}
                headerMediaUrl={templateHeaderMediaUrl}
                onHeaderMediaUrlChange={setTemplateHeaderMediaUrl}
                idPrefix="campaign"
              />
            ) : (
              <label className="block space-y-1.5 text-sm font-medium">
                Mensaje
                <Textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} maxLength={4000} rows={5} placeholder="Escribe el mensaje que recibirán los contactos elegibles…" />
              </label>
            )}
          </div>

          <div className="space-y-3 rounded-lg border bg-subtle p-4">
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
            {isWhatsapp && (
              <label className="flex items-start gap-2 border-t pt-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={effectiveOptInOnly}
                  disabled={marketingTemplate}
                  onChange={(event) => { setOptInOnly(event.target.checked); setPreview(null); }}
                />
                <span>
                  Solo contactos con opt-in de marketing
                  <span className="block text-[11px] leading-snug text-muted-foreground">
                    {marketingTemplate
                      ? "Obligatorio para plantillas de marketing: Meta exige consentimiento previo."
                      : "Filtra a quienes autorizaron promociones por WhatsApp."}
                  </span>
                </span>
              </label>
            )}
            <div className="flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
              <Clock3 className="h-4 w-4 shrink-0" /> Solo se incluyen contactos activos con conversación elegible.
            </div>
          </div>
        </div>

        {preview && (
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-background px-4 py-3 text-sm">
            <span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" /> {preview.total} en el segmento</span>
            <span className="text-emerald-700">{preview.queued} salen de inmediato</span>
            {preview.waiting > 0 && (
              <span className="inline-flex items-center gap-1.5 text-sky-700">
                <Clock3 className="h-4 w-4" /> {preview.waiting} esperan a que el cliente escriba
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-amber-700"><AlertCircle className="h-4 w-4" /> {preview.skipped} se omitirán</span>
            {Object.entries(preview.skippedByReason).map(([reason, count]) => <span key={reason} className="text-xs text-muted-foreground">{skipLabels[reason] ?? reason}: {count}</span>)}
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => void previewAudience()} disabled={busy}>
            <Users className="mr-2 h-4 w-4" /> {busy ? "Calculando…" : "Previsualizar segmento"}
          </Button>
          <Button onClick={() => void createCampaign()} disabled={busy || !name.trim() || !messageReady}>
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
                  <span className="rounded-full border border-border bg-subtle px-2 py-0.5 text-xs text-muted-foreground">{CHANNEL_LABEL[campaign.channel as Channel] ?? campaign.channel}</span>
                  {campaign.templateName && (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700">
                      Plantilla {campaign.templateName}
                      {campaign.templateCategory ? ` · ${TEMPLATE_CATEGORY_LABEL[campaign.templateCategory] ?? campaign.templateCategory}` : ""}
                    </span>
                  )}
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${campaign.status === "sending" ? "border-blue-500/30 bg-blue-500/10 text-blue-700" : "border-border bg-subtle text-muted-foreground"}`}>
                    {campaign.status === "sending" && new Date(campaign.scheduledAt).getTime() > Date.now()
                      ? "Programada"
                      : statusLabels[campaign.status] ?? campaign.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {campaign.recipientCount} contactos ·{" "}
                  {new Date(campaign.scheduledAt).getTime() > Date.now()
                    ? `programada para ${new Date(campaign.scheduledAt).toLocaleString("es-MX")}`
                    : new Date(campaign.createdAt).toLocaleString("es-MX")}
                </p>
              </div>
              <div className="flex gap-2">
                {(campaign.status === "draft" || campaign.status === "paused") && <Button size="sm" onClick={() => void setCampaignState(campaign, "start")}><Play className="mr-1.5 h-3.5 w-3.5" /> {campaign.status === "paused" ? "Reanudar" : "Iniciar"}</Button>}
                {campaign.status === "sending" && <Button size="sm" variant="secondary" onClick={() => void setCampaignState(campaign, "pause")}><Pause className="mr-1.5 h-3.5 w-3.5" /> Pausar</Button>}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-6">
              <Metric label="Enviados" value={campaign.sentCount} />
              <Metric label="Entregados" value={campaign.deliveredCount} />
              <Metric label="Leídos" value={campaign.readCount} />
              <Metric label="En espera" value={campaign.waitingCount ?? 0} />
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
  return <div className="rounded-lg bg-subtle px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p></div>;
}
