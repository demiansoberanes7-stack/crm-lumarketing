"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Code2,
  Eye,
  FileSpreadsheet,
  Mail,
  Paperclip,
  Pause,
  Play,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { EMAIL_TEMPLATE_HTML_MAX } from "@/lib/email-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";

type Account = {
  id: string;
  label: string;
  emailAddress: string;
  fromName: string | null;
  enabled: boolean;
  dailyLimit: number;
};

type Campaign = {
  id: string;
  name: string;
  subject: string | null;
  status: string;
  senderAccountId: string | null;
  senderLabel: string | null;
  senderEmail: string | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

type Audience = {
  contacts: number;
  mailbox: number;
  limit: number;
};

type Recipient = { email: string; name: string | null };

type ListPreview = {
  count: number;
  sample: Recipient[];
  overLimit?: boolean;
  limit: number;
};

type UploadResult = {
  filename: string;
  count: number;
  recipients: Recipient[];
  rowsWithoutEmail: number;
  overLimit: boolean;
  limit: number;
};

type AudienceKind = "contacts" | "mailbox" | "manual" | "file";

type EmailTemplate = {
  id: string;
  name: string;
  subject: string;
  htmlLength: number;
  createdAt: string;
};

type EmailTemplateDetail = EmailTemplate & { html: string };

const statusLabels: Record<string, string> = {
  draft: "Borrador",
  sending: "Enviando",
  paused: "Pausada",
  completed: "Finalizada",
};

function errorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const error = (data as { error?: { message?: string } }).error;
  return typeof error?.message === "string" ? error.message : null;
}

/** Valores de muestra para que la vista previa muestre el marcado final. */
function withSampleRecipient(html: string): string {
  return html
    .replace(/\{\{\s*nombre\s*\}\}/gi, "María López")
    .replace(/\{\{\s*correo\s*\}\}/gi, "maria@empresa.com");
}

export function BroadcastsClient() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [campaignsFailed, setCampaignsFailed] = useState(false);
  const [accountsFailed, setAccountsFailed] = useState(false);
  const [audienceFailed, setAudienceFailed] = useState(false);

  const [name, setName] = useState("");
  const [senderAccountId, setSenderAccountId] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [kind, setKind] = useState<AudienceKind>("contacts");
  const [manualText, setManualText] = useState("");
  const [manualPreview, setManualPreview] = useState<ListPreview | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templatesFailed, setTemplatesFailed] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [templateHtml, setTemplateHtml] = useState("");
  const [templateBusy, setTemplateBusy] = useState(false);
  const [showCampaignPreview, setShowCampaignPreview] = useState(false);
  const [openTemplateId, setOpenTemplateId] = useState<string | null>(null);
  const [openTemplateHtml, setOpenTemplateHtml] = useState("");
  const [tplName, setTplName] = useState("");
  const [tplSubject, setTplSubject] = useState("");
  const [tplHtml, setTplHtml] = useState("");
  const [tplBusy, setTplBusy] = useState(false);
  const [showDraftPreview, setShowDraftPreview] = useState(false);
  const tplFileInput = useRef<HTMLInputElement | null>(null);

  const selectedAccount = accounts.find((account) => account.id === senderAccountId) ?? null;
  const enabledAccounts = accounts.filter((account) => account.enabled);
  const sending = campaigns.some((campaign) => campaign.status === "sending");

  const loadAudience = useCallback(async () => {
    const response = await fetch("/api/email-campaigns/audience", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      setAudienceFailed(true);
      return;
    }
    const data = (await response.json()) as Audience;
    setAudience(data);
    setAudienceFailed(false);
  }, []);

  const loadTemplates = useCallback(async () => {
    const response = await fetch("/api/email-campaigns/templates", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      setTemplatesFailed(true);
      return;
    }
    const data = (await response.json()) as { templates?: EmailTemplate[] };
    setTemplates(Array.isArray(data.templates) ? data.templates : []);
    setTemplatesFailed(false);
  }, []);

  const refresh = useCallback(async () => {
    const [campaignResponse] = await Promise.all([
      fetch("/api/email-campaigns", { cache: "no-store" }).catch(() => null),
      loadAudience(),
      loadTemplates(),
    ]);
    if (campaignResponse?.ok) {
      const data = (await campaignResponse.json()) as { campaigns: Campaign[]; accounts: Account[] };
      setCampaigns(data.campaigns ?? []);
      setAccounts(data.accounts ?? []);
      setCampaignsFailed(false);
      setAccountsFailed(false);
      setSenderAccountId((current) => {
        if (data.accounts.some((account) => account.id === current && account.enabled)) return current;
        return data.accounts.find((account) => account.enabled)?.id ?? "";
      });
    } else {
      setCampaignsFailed(true);
      setAccountsFailed(true);
    }
  }, [loadAudience, loadTemplates]);

  const refreshCampaigns = useCallback(async () => {
    const response = await fetch("/api/email-campaigns", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const data = (await response.json()) as { campaigns: Campaign[]; accounts: Account[] };
    setCampaigns(data.campaigns ?? []);
    setCampaignsFailed(false);
    setAccountsFailed(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => void refreshCampaigns(), 3_000);
    return () => clearInterval(timer);
  }, [sending, refreshCampaigns]);

  const audienceCount = useMemo(() => {
    if (kind === "contacts") return audience?.contacts ?? null;
    if (kind === "mailbox") return audience?.mailbox ?? null;
    if (kind === "manual") return manualPreview?.count ?? null;
    return upload?.count ?? null;
  }, [kind, audience, manualPreview, upload]);

  const overLimit = Boolean(
    (kind === "manual" && manualPreview?.overLimit) ||
    (kind === "file" && upload?.overLimit) ||
    (audienceCount != null && audience != null && audienceCount > audience.limit)
  );

  const audienceReady = kind === "manual"
    ? manualText.trim().length > 0
    : kind === "file"
      ? Boolean(upload && upload.count > 0 && !upload.overLimit)
      : Boolean(audience && audienceCount != null && audienceCount > 0);

  const canCreate = Boolean(
    name.trim() &&
    senderAccountId &&
    selectedAccount?.enabled &&
    subject.trim() &&
    (bodyText.trim() || templateHtml) &&
    audienceReady &&
    !overLimit
  );

  async function previewManual() {
    if (!manualText.trim()) {
      setError("Pega al menos un correo.");
      return;
    }
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/email-campaigns/audience", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "list", text: manualText }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data) ?? "No se pudo leer la lista");
      setManualPreview(data as ListPreview);
    } catch (cause) {
      setManualPreview(null);
      setError(cause instanceof Error ? cause.message : "No se pudo leer la lista");
    } finally { setBusy(false); }
  }

  async function uploadFile(file: File) {
    setUploading(true); setError(null); setNotice(null); setUpload(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/email-campaigns/parse", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data) ?? "No se pudo leer el archivo");
      setUpload(data as UploadResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo leer el archivo");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function chooseTemplate(id: string) {
    if (!id) {
      setTemplateId("");
      setTemplateHtml("");
      setShowCampaignPreview(false);
      return;
    }
    setTemplateBusy(true); setError(null);
    try {
      const response = await fetch(`/api/email-campaigns/templates/${id}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data) ?? "No se pudo abrir la plantilla");
      const template = (data as { template: EmailTemplateDetail }).template;
      setTemplateId(template.id);
      setTemplateHtml(template.html);
      setSubject(template.subject);
    } catch (cause) {
      setTemplateId("");
      setTemplateHtml("");
      setShowCampaignPreview(false);
      setError(cause instanceof Error ? cause.message : "No se pudo abrir la plantilla");
    } finally {
      setTemplateBusy(false);
    }
  }

  async function loadTemplateFile(file: File) {
    setError(null);
    if (file.size > 1_000_000) {
      setError("El archivo HTML es demasiado grande (más de 1 MB).");
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        setError("El archivo HTML está vacío.");
        return;
      }
      if (text.length > EMAIL_TEMPLATE_HTML_MAX) {
        setError(`El HTML supera el límite de ${EMAIL_TEMPLATE_HTML_MAX.toLocaleString("es-MX")} caracteres.`);
        return;
      }
      setTplHtml(text);
      setTplName((current) => (current.trim() ? current : file.name.replace(/\.html?$/i, "")));
      setShowDraftPreview(true);
    } catch {
      setError("No se pudo leer el archivo HTML.");
    } finally {
      if (tplFileInput.current) tplFileInput.current.value = "";
    }
  }

  async function saveTemplate() {
    if (!tplName.trim() || !tplSubject.trim() || !tplHtml.trim()) {
      setError("Completa nombre, asunto y HTML de la plantilla.");
      return;
    }
    if (tplHtml.length > EMAIL_TEMPLATE_HTML_MAX) {
      setError(`El HTML supera el límite de ${EMAIL_TEMPLATE_HTML_MAX.toLocaleString("es-MX")} caracteres.`);
      return;
    }
    setTplBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/email-campaigns/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: tplName, subject: tplSubject, html: tplHtml }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data) ?? "No se pudo guardar la plantilla");
      const template = (data as { template: EmailTemplate }).template;
      setNotice(`Plantilla «${template.name}» guardada. Ya puedes elegirla en una campaña.`);
      setTplName(""); setTplSubject(""); setTplHtml(""); setShowDraftPreview(false);
      await loadTemplates();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la plantilla");
    } finally {
      setTplBusy(false);
    }
  }

  async function removeTemplate(template: EmailTemplate) {
    if (!window.confirm(
      `¿Eliminar la plantilla «${template.name}»? Las campañas ya guardadas conservan su copia.`
    )) return;
    setTplBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/email-campaigns/templates/${template.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data) ?? "No se pudo eliminar la plantilla");
      if (templateId === template.id) {
        setTemplateId("");
        setTemplateHtml("");
        setShowCampaignPreview(false);
      }
      if (openTemplateId === template.id) {
        setOpenTemplateId(null);
        setOpenTemplateHtml("");
      }
      setNotice(`Plantilla «${template.name}» eliminada.`);
      await loadTemplates();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo eliminar la plantilla");
    } finally {
      setTplBusy(false);
    }
  }

  async function toggleTemplatePreview(template: EmailTemplate) {
    if (openTemplateId === template.id) {
      setOpenTemplateId(null);
      setOpenTemplateHtml("");
      return;
    }
    setOpenTemplateId(template.id);
    setOpenTemplateHtml("");
    setError(null);
    try {
      const response = await fetch(`/api/email-campaigns/templates/${template.id}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data) ?? "No se pudo abrir la plantilla");
      setOpenTemplateHtml((data as { template: EmailTemplateDetail }).template.html);
    } catch (cause) {
      setOpenTemplateId(null);
      setError(cause instanceof Error ? cause.message : "No se pudo abrir la plantilla");
    }
  }

  async function createCampaign() {
    if (!canCreate) {
      setError("Completa nombre, remitente, asunto, una plantilla o mensaje, y una audiencia con correos.");
      return;
    }
    setBusy(true); setError(null); setNotice(null);
    try {
      const payload = {
        name,
        senderAccountId,
        subject,
        // Con plantilla, el texto es opcional: el servidor lo deriva del HTML.
        bodyText: bodyText.trim() || undefined,
        bodyHtml: templateHtml || undefined,
        audience: kind === "contacts" || kind === "mailbox"
          ? { kind }
          : kind === "manual"
            ? { kind: "list", text: manualText }
            : { kind: "list", recipients: upload?.recipients ?? [] },
      };
      const response = await fetch("/api/email-campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data) ?? "No se pudo guardar la campaña");
      const campaign = (data as { campaign: { recipientCount: number } }).campaign;
      setNotice(
        `Campaña guardada con ${campaign.recipientCount} correos. Revísala y pulsa «Enviar» cuando quieras lanzarla.`
      );
      setName(""); setSubject(""); setBodyText("");
      setTemplateId(""); setTemplateHtml(""); setShowCampaignPreview(false);
      setManualText(""); setManualPreview(null); setUpload(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la campaña");
    } finally { setBusy(false); }
  }

  async function setCampaignState(campaign: Campaign, action: "start" | "pause") {
    if (action === "start" && campaign.status === "draft") {
      const sender = campaign.senderLabel ?? campaign.senderEmail ?? "la cuenta configurada";
      const confirmed = window.confirm(
        `Se enviarán ${campaign.recipientCount} correos desde ${sender}. Esta acción no se puede deshacer. ¿Enviar ahora?`
      );
      if (!confirmed) return;
    }
    setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/broadcasts/${campaign.id}/${action}`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data) ?? "No se pudo cambiar el estado de la campaña");
      await refreshCampaigns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar el estado de la campaña");
    }
  }

  const sample: Recipient[] = kind === "manual"
    ? manualPreview?.sample ?? []
    : kind === "file"
      ? upload?.recipients.slice(0, 8) ?? []
      : [];

  return (
    <div className="mx-auto h-full w-full max-w-6xl space-y-6 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        module="Campañas por correo"
        title="Envíos masivos"
        description="Envía correos a los contactos del CRM, a quienes ya escribieron al buzón, o a una lista que cargues a mano o desde Excel/CSV. La lista queda congelada al guardar la campaña."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void refresh()} aria-label="Actualizar campañas">
            <RefreshCw className="mr-2 h-4 w-4" /> Actualizar
          </Button>
        }
        className="rounded-xl border"
      />

      {(error || notice) && (
        <div
          role={error ? "alert" : "status"}
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${error ? "border-red-500/30 bg-red-500/5 text-red-700" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700"}`}
        >
          <span>{error ?? notice}</span>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => { setError(null); setNotice(null); }}
            className="rounded p-0.5 hover:bg-black/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {accountsFailed && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800">
          No se pudieron leer las cuentas de correo. Sin remitente no se puede crear una campaña;
          reintenta con «Actualizar».
        </div>
      )}

      {!accountsFailed && accounts.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800">
          No hay cuentas de correo configuradas. Agrega una en{" "}
          <a className="font-medium underline" href="/inbox">Bandeja → Correo</a> y vuelve aquí.
        </div>
      )}

      <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-tint text-brand-text"><Mail className="h-4 w-4" /></span>
          <div>
            <h2 className="font-semibold">Nueva campaña de correo</h2>
            <p className="text-xs text-muted-foreground">
              Se guarda como borrador: nada sale hasta que pulses «Enviar» en la lista.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)]">
          <div className="space-y-4">
            <label className="block space-y-1.5 text-sm font-medium">
              Cuenta remitente
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                value={senderAccountId}
                onChange={(event) => setSenderAccountId(event.target.value)}
                aria-label="Cuenta remitente"
              >
                {enabledAccounts.length === 0 && <option value="">Sin cuentas disponibles</option>}
                {enabledAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label} · {account.emailAddress}
                  </option>
                ))}
              </select>
            </label>
            {selectedAccount && (
              <p className="-mt-2 text-[11px] leading-snug text-muted-foreground">
                Límite diario de esta cuenta: {selectedAccount.dailyLimit > 0 ? `${selectedAccount.dailyLimit} correos` : "sin límite"}.
                Si la campaña lo supera, continúa automáticamente al día siguiente.
              </p>
            )}
            <label className="block space-y-1.5 text-sm font-medium">
              Nombre de la campaña
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} placeholder="Promoción octubre" />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Plantilla HTML (opcional)
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                value={templateId}
                onChange={(event) => void chooseTemplate(event.target.value)}
                disabled={templateBusy}
                aria-label="Plantilla HTML"
              >
                <option value="">Sin plantilla — solo texto</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · {template.subject}
                  </option>
                ))}
              </select>
            </label>
            {templateBusy && (
              <p className="-mt-2 text-[11px] text-muted-foreground">Cargando plantilla…</p>
            )}
            {templatesFailed && (
              <p className="-mt-2 text-[11px] text-amber-700">
                No se pudieron leer las plantillas guardadas.{" "}
                <button type="button" className="underline" onClick={() => void loadTemplates()}>Reintentar</button>
              </p>
            )}
            {templateHtml && (
              <div className="-mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Code2 className="h-3.5 w-3.5" />
                  {templateHtml.length.toLocaleString("es-MX")} caracteres de HTML cargados
                </span>
                <button type="button" className="underline" onClick={() => setShowCampaignPreview((open) => !open)}>
                  {showCampaignPreview ? "Ocultar vista previa" : "Vista previa"}
                </button>
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setTemplateId("");
                    setTemplateHtml("");
                    setShowCampaignPreview(false);
                  }}
                >
                  Quitar plantilla
                </button>
              </div>
            )}
            {templateHtml && showCampaignPreview && (
              <TemplatePreview html={templateHtml} title="Vista previa de la campaña" />
            )}
            <label className="block space-y-1.5 text-sm font-medium">
              Asunto
              <Input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={300} placeholder="Tu cotización está lista" />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              {templateHtml ? "Mensaje (versión de texto de respaldo)" : "Mensaje"}
              <Textarea
                value={bodyText}
                onChange={(event) => setBodyText(event.target.value)}
                maxLength={50_000}
                rows={7}
                placeholder={templateHtml
                  ? "Opcional: si lo dejas vacío se genera automáticamente desde el HTML"
                  : "Hola {{nombre}}, tenemos una novedad para ti…"}
              />
              <span className="block text-[11px] font-normal leading-snug text-muted-foreground">
                {templateHtml
                  ? "El correo lleva el HTML y esta versión de texto como alternativa. Puedes usar {{nombre}} y {{correo}} en ambos."
                  : "Puedes usar {{nombre}} y {{correo}}; se reemplazan por los datos de cada destinatario."}
              </span>
            </label>
          </div>

          <div className="space-y-3 rounded-lg border bg-subtle p-4">
            <h3 className="text-sm font-semibold">Audiencia</h3>
            <div className="space-y-2">
              <AudienceOption
                checked={kind === "contacts"}
                onSelect={() => setKind("contacts")}
                title="Contactos del CRM"
                detail="Contactos activos con correo en su ficha."
                count={audienceFailed ? null : audience?.contacts ?? null}
              />
              <AudienceOption
                checked={kind === "mailbox"}
                onSelect={() => setKind("mailbox")}
                title="Remitentes del buzón"
                detail="Correos que ya escribieron a tus cuentas (sin tus propias direcciones)."
                count={audienceFailed ? null : audience?.mailbox ?? null}
              />
              <AudienceOption
                checked={kind === "manual"}
                onSelect={() => setKind("manual")}
                title="Cargar a mano"
                detail="Pega una lista de correos separados por líneas, comas o punto y coma."
                count={manualPreview?.count ?? null}
              />
              <AudienceOption
                checked={kind === "file"}
                onSelect={() => setKind("file")}
                title="Archivo Excel o CSV"
                detail="Primera hoja de un .xlsx, o un .csv/.tsv/.txt con encabezados «correo» y «nombre»."
                count={upload?.count ?? null}
              />
            </div>

            {audienceFailed && (
              <p className="text-xs text-amber-700">
                No se pudieron contar los contactos ni los remitentes.{" "}
                <button type="button" className="underline" onClick={() => void loadAudience()}>Reintentar</button>
              </p>
            )}

            {kind === "manual" && (
              <div className="space-y-2 border-t pt-3">
                <Textarea
                  rows={5}
                  value={manualText}
                  onChange={(event) => { setManualText(event.target.value); setManualPreview(null); }}
                  placeholder={"juan@empresa.com\nMaría López <maria@empresa.com>"}
                  aria-label="Correos para la campaña"
                />
                <Button size="sm" variant="secondary" onClick={() => void previewManual()} disabled={busy || !manualText.trim()}>
                  <Users className="mr-2 h-4 w-4" /> Revisar correos
                </Button>
                {manualPreview && (
                  <ListSummary count={manualPreview.count} limit={manualPreview.limit} sample={sample} />
                )}
              </div>
            )}

            {kind === "file" && (
              <div className="space-y-2 border-t pt-3">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,.csv,.tsv,.txt"
                  className="block w-full cursor-pointer rounded-md border bg-background px-3 py-2 text-xs file:mr-3 file:rounded file:border-0 file:bg-brand-tint file:px-2 file:py-1 file:text-brand-text"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadFile(file);
                  }}
                  aria-label="Archivo de correos"
                />
                {uploading && <p className="text-xs text-muted-foreground">Leyendo archivo…</p>}
                {upload && (
                  <div className="space-y-1 text-xs">
                    <p className="inline-flex items-center gap-1.5 font-medium">
                      <FileSpreadsheet className="h-3.5 w-3.5" /> {upload.filename}: {upload.count} correos
                    </p>
                    {upload.rowsWithoutEmail > 0 && (
                      <p className="text-amber-700">{upload.rowsWithoutEmail} fila(s) sin correo se ignoraron.</p>
                    )}
                    {upload.overLimit && (
                      <p className="text-red-700">Supera el límite de {upload.limit} correos por campaña.</p>
                    )}
                    <ListSummary count={upload.count} limit={upload.limit} sample={sample} />
                  </div>
                )}
              </div>
            )}

            <div className="flex items-start gap-2 border-t pt-3 text-xs text-muted-foreground">
              <Paperclip className="mt-0.5 h-4 w-4 shrink-0" />
              Los correos repetidos se envían una sola vez. El archivo no se guarda: se lee y se descarta.
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {audienceCount != null
              ? `${audienceCount} destinatario(s) en la audiencia${overLimit ? " — supera el límite" : ""}`
              : "Elige una audiencia para ver el total."}
          </p>
          <Button onClick={() => void createCampaign()} disabled={busy || !canCreate}>
            <Send className="mr-2 h-4 w-4" /> {busy ? "Guardando…" : "Guardar campaña"}
          </Button>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand-text">
            <Code2 className="h-4 w-4" />
          </span>
          <div>
            <h2 className="font-semibold">Plantillas de correo</h2>
            <p className="max-w-2xl text-xs text-muted-foreground">
              Carga un archivo .html o pega el código una vez y reutilízalo en cualquier campaña.
              Cada campaña guarda su propia copia: borrar la plantilla no cambia envíos ya creados.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Guardadas ({templates.length})</h3>
            {templatesFailed ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800">
                No se pudo leer la lista de plantillas.{" "}
                <button type="button" className="underline" onClick={() => void loadTemplates()}>Reintentar</button>
              </p>
            ) : templates.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                Todavía no hay plantillas guardadas. Sube o pega un HTML a la derecha.
              </p>
            ) : templates.map((template) => (
              <article key={template.id} className="rounded-lg border bg-background px-3 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{template.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{template.subject}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {Math.max(1, Math.ceil(template.htmlLength / 1024))} KB ·{" "}
                      {new Date(template.createdAt).toLocaleDateString("es-MX")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void chooseTemplate(template.id)}
                      disabled={tplBusy}
                    >
                      Usar en campaña
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void toggleTemplatePreview(template)}
                      aria-label={`Vista previa de ${template.name}`}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void removeTemplate(template)}
                      disabled={tplBusy}
                      aria-label={`Eliminar ${template.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {openTemplateId === template.id && (
                  <div className="mt-2">
                    {openTemplateHtml
                      ? <TemplatePreview html={openTemplateHtml} title={`Vista previa de ${template.name}`} />
                      : <p className="text-xs text-muted-foreground">Cargando vista previa…</p>}
                  </div>
                )}
              </article>
            ))}
          </div>

          <form
            className="space-y-3 rounded-lg border bg-subtle p-4"
            onSubmit={(event) => { event.preventDefault(); void saveTemplate(); }}
          >
            <h3 className="text-sm font-semibold">Nueva plantilla</h3>
            <label className="block space-y-1.5 text-sm font-medium">
              Nombre
              <Input
                value={tplName}
                onChange={(event) => setTplName(event.target.value)}
                maxLength={160}
                placeholder="Promoción de octubre"
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Asunto
              <Input
                value={tplSubject}
                onChange={(event) => setTplSubject(event.target.value)}
                maxLength={300}
                placeholder="Hola {{nombre}}, tenemos una novedad"
              />
            </label>
            <div className="space-y-1.5 text-sm font-medium">
              <label htmlFor="template-file">Archivo HTML</label>
              <input
                id="template-file"
                ref={tplFileInput}
                type="file"
                accept=".html,.htm,text/html"
                className="block w-full cursor-pointer rounded-md border bg-background px-3 py-2 text-xs file:mr-3 file:rounded file:border-0 file:bg-brand-tint file:px-2 file:py-1 file:text-brand-text"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void loadTemplateFile(file);
                }}
              />
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              HTML
              <Textarea
                value={tplHtml}
                onChange={(event) => { setTplHtml(event.target.value); setShowDraftPreview(false); }}
                maxLength={EMAIL_TEMPLATE_HTML_MAX}
                rows={8}
                placeholder={"<table>…</table>\n\nHola {{nombre}},…"}
                className="font-mono text-xs"
              />
              <span className="block text-[11px] font-normal leading-snug text-muted-foreground">
                Acepta {"{{nombre}}"} y {"{{correo}}"} escapados dentro del HTML. Máximo{" "}
                {EMAIL_TEMPLATE_HTML_MAX.toLocaleString("es-MX")} caracteres.
              </span>
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (!tplHtml.trim()) {
                    setError("Pega o sube el HTML para verlo.");
                    return;
                  }
                  setShowDraftPreview((open) => !open);
                }}
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                {showDraftPreview ? "Ocultar vista previa" : "Vista previa"}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={tplBusy || !tplName.trim() || !tplSubject.trim() || !tplHtml.trim()}
              >
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                {tplBusy ? "Guardando…" : "Guardar plantilla"}
              </Button>
            </div>
            {showDraftPreview && tplHtml.trim() && (
              <TemplatePreview html={tplHtml} title={tplName.trim() || "Vista previa de la plantilla"} />
            )}
          </form>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Campañas guardadas</h2>
          <span className="text-xs text-muted-foreground">El envío se hace desde aquí, campaña por campaña.</span>
        </div>
        {campaignsFailed && campaigns.length === 0 ? (
          <LoadError
            message="No se pudo leer la lista de campañas."
            detail="«Todavía no hay campañas» sería otra cosa: la lista no llegó. Reintenta antes de crear una nueva para no duplicar el envío."
            onRetry={() => void refresh()}
          />
        ) : campaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            Todavía no hay campañas de correo.
          </div>
        ) : campaigns.map((campaign) => {
          const pending = Math.max(
            0,
            campaign.recipientCount - campaign.sentCount - campaign.failedCount - campaign.skippedCount
          );
          const progress = campaign.recipientCount > 0
            ? Math.round(((campaign.sentCount + campaign.failedCount + campaign.skippedCount) / campaign.recipientCount) * 100)
            : 0;
          return (
            <article key={campaign.id} className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{campaign.name}</h3>
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${campaign.status === "sending" ? "border-blue-500/30 bg-blue-500/10 text-blue-700" : campaign.status === "completed" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "border-border bg-subtle text-muted-foreground"}`}>
                      {statusLabels[campaign.status] ?? campaign.status}
                    </span>
                  </div>
                  {campaign.subject && <p className="mt-1 truncate text-sm text-muted-foreground">{campaign.subject}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {campaign.recipientCount} destinatarios ·{" "}
                    {campaign.senderLabel ?? campaign.senderEmail ?? "cuenta eliminada"} ·{" "}
                    {new Date(campaign.createdAt).toLocaleString("es-MX")}
                  </p>
                </div>
                <div className="flex gap-2">
                  {(campaign.status === "draft" || campaign.status === "paused") && (
                    <Button size="sm" onClick={() => void setCampaignState(campaign, "start")}>
                      <Play className="mr-1.5 h-3.5 w-3.5" /> {campaign.status === "paused" ? "Reanudar" : "Enviar"}
                    </Button>
                  )}
                  {campaign.status === "sending" && (
                    <Button size="sm" variant="secondary" onClick={() => void setCampaignState(campaign, "pause")}>
                      <Pause className="mr-1.5 h-3.5 w-3.5" /> Pausar
                    </Button>
                  )}
                </div>
              </div>
              {campaign.status === "sending" && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-subtle">
                  <div className="h-full rounded-full bg-brand-text transition-all" style={{ width: `${progress}%` }} />
                </div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Enviados" value={campaign.sentCount} icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />} />
                <Metric label="Pendientes" value={pending} />
                <Metric label="Fallidos" value={campaign.failedCount} icon={campaign.failedCount > 0 ? <AlertCircle className="h-3.5 w-3.5 text-red-600" /> : undefined} />
                <Metric label="Omitidos" value={campaign.skippedCount} />
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function AudienceOption(input: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
  count: number | null;
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition ${input.checked ? "border-brand-text/40 bg-background" : "border-transparent hover:bg-background/60"}`}>
      <input type="radio" className="mt-1" checked={input.checked} onChange={input.onSelect} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium">{input.title}</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {input.count == null ? "—" : `${input.count}`}
          </span>
        </span>
        <span className="block text-[11px] leading-snug text-muted-foreground">{input.detail}</span>
      </span>
    </label>
  );
}

function ListSummary({ count, limit, sample }: { count: number; limit: number; sample: Recipient[] }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs">
      <p className={count > limit ? "font-medium text-red-700" : "font-medium"}>
        {count} correo(s) válido(s){count > limit ? ` · máximo ${limit}` : ""}
      </p>
      {sample.length > 0 && (
        <p className="mt-1 truncate text-muted-foreground">
          {sample.map((recipient) => recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email).join(", ")}
        </p>
      )}
    </div>
  );
}

/**
 * El HTML lo escribe el negocio, pero se pinta aislado de todos modos: sin
 * scripts, sin same-origin y sin acceso a la sesión del CRM.
 */
function TemplatePreview({ html, title }: { html: string; title: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className="flex items-center justify-between gap-2 border-b bg-subtle px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="truncate">{title}</span>
        <span className="shrink-0">Vista previa aislada · sin scripts</span>
      </div>
      <iframe
        title={title}
        sandbox=""
        srcDoc={withSampleRecipient(html)}
        className="h-72 w-full"
      />
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-subtle px-3 py-2">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">{icon}{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
