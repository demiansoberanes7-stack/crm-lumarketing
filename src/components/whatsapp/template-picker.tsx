"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Plantilla aprobada tal como la devuelve /api/whatsapp/templates. */
export type WhatsappTemplateDto = {
  id: string;
  name: string;
  language: string;
  category: string | null;
  status: string;
  bodyText: string;
  variableCount: number;
  /** TEXT | IMAGE | VIDEO | DOCUMENT | LOCATION (null sin encabezado). */
  headerFormat?: string | null;
  headerText?: string;
  /** Exige un enlace público https con la imagen, video o documento. */
  headerMediaRequired?: boolean;
  /** Motivo por el que la plantilla no se puede enviar desde aquí. */
  automationIssue?: string | null;
};

type TemplatesPayload = {
  provider?: string;
  templates?: WhatsappTemplateDto[];
  error?: { message?: string };
};

export const TEMPLATE_CATEGORY_LABEL: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidad",
  AUTHENTICATION: "Autenticación",
};

/** MARKETING exige opt-in previo; UTILITY va atada a una transacción. */
export function templateRequiresOptIn(
  category: string | null | undefined
): boolean {
  return (category ?? "").toUpperCase() === "MARKETING";
}

function renderName(value: string, contactName: string | null | undefined) {
  return value.replace(/\{\{\s*nombre\s*\}\}/gi, contactName?.trim() || "cliente");
}

/** Sustituye `{{1}}…{{n}}` con los valores capturados (solo para la vista previa). */
export function renderTemplatePreview(
  bodyText: string,
  params: readonly string[],
  contactName?: string | null
): string {
  return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, rawIndex: string) => {
    const value = params[Number(rawIndex) - 1];
    return value?.trim() ? renderName(value, contactName) : whole;
  });
}

export function templateParamsComplete(
  template: WhatsappTemplateDto | null,
  params: readonly string[]
): boolean {
  if (!template || !template.category) return false;
  return (
    params.length === template.variableCount &&
    params.every((param) => param.trim().length > 0)
  );
}

export function templateHeaderReady(
  template: WhatsappTemplateDto | null,
  headerMediaUrl: string
): boolean {
  if (!template?.headerMediaRequired) return true;
  return /^https:\/\/\S+$/i.test(headerMediaUrl.trim());
}

/** La plantilla puede enviarse tal como está configurada en el formulario. */
export function templateReady(
  template: WhatsappTemplateDto | null,
  params: readonly string[],
  headerMediaUrl: string
): boolean {
  return (
    templateParamsComplete(template, params) &&
    !template?.automationIssue &&
    templateHeaderReady(template, headerMediaUrl)
  );
}

/** Lista de plantillas aprobadas; solo consulta el proveedor cuando se usa. */
export function useWhatsappTemplates(enabled: boolean) {
  const [templates, setTemplates] = useState<WhatsappTemplateDto[]>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true);
    setError(null);
    fetch("/api/whatsapp/templates", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response
          .json()
          .catch(() => ({}))) as TemplatesPayload;
        if (!response.ok) {
          throw new Error(
            data.error?.message ?? "No se pudieron cargar las plantillas aprobadas."
          );
        }
        return data;
      })
      .then((data) => {
        if (!active) return;
        setTemplates(data.templates ?? []);
        setProvider(data.provider ?? null);
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Error de conexión."
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  return { templates, provider, loading, error, reload };
}

export function WhatsappTemplatePicker({
  templates,
  provider,
  loading,
  error,
  onReload,
  selected,
  params,
  onSelect,
  onParamsChange,
  headerMediaUrl,
  onHeaderMediaUrlChange,
  contactName,
  idPrefix = "tpl",
}: {
  templates: WhatsappTemplateDto[];
  provider: string | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  selected: WhatsappTemplateDto | null;
  params: string[];
  onSelect: (template: WhatsappTemplateDto | null) => void;
  onParamsChange: (params: string[]) => void;
  headerMediaUrl: string;
  onHeaderMediaUrlChange: (url: string) => void;
  /** Nombre del contacto para mostrar la personalización {{nombre}}. */
  contactName?: string | null;
  idPrefix?: string;
}) {
  const requiresOptIn = templateRequiresOptIn(selected?.category);
  // Las de autenticación solo sirven para códigos de un solo uso y las que
  // traen componentes que este envío no sabe construir se deshabilitan: usarlas
  // en una campaña o un programado incumple su propósito aprobado.
  const usableTemplates = templates.filter(
    (template) =>
      (template.category ?? "").toUpperCase() !== "AUTHENTICATION" &&
      !template.automationIssue
  );
  const preview = selected
    ? renderTemplatePreview(selected.bodyText, params, contactName)
    : "";

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor={`${idPrefix}-template`}>
          Plantilla aprobada
        </label>
        <select
          id={`${idPrefix}-template`}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
          value={selected ? `${selected.name}:${selected.language}` : ""}
          onChange={(event) => {
            const key = event.target.value;
            onSelect(
              templates.find(
                (template) => `${template.name}:${template.language}` === key
              ) ?? null
            );
          }}
        >
          <option value="">Selecciona una plantilla aprobada…</option>
          {usableTemplates.map((template) => {
            const category = template.category
              ? TEMPLATE_CATEGORY_LABEL[template.category] ?? template.category
              : "sin categoría";
            return (
              <option
                key={`${template.name}:${template.language}`}
                value={`${template.name}:${template.language}`}
                disabled={!template.category || Boolean(template.automationIssue)}
              >
                {template.name} · {template.language} · {category}
                {template.automationIssue ? ` · ${template.automationIssue}` : ""}
              </option>
            );
          })}
        </select>
      </div>

      {loading && (
        <p className="text-xs text-muted-foreground">
          Cargando plantillas aprobadas del número…
        </p>
      )}
      {error && (
        <div className="flex items-start justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={onReload}
            className="inline-flex shrink-0 items-center gap-1 font-medium hover:underline"
          >
            <RefreshCw className="h-3 w-3" /> Reintentar
          </button>
        </div>
      )}
      {!loading && !error && provider === "waha" && (
        <p className="rounded-md border bg-subtle px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          Este número usa WAHA, que no maneja plantillas aprobadas. El texto
          libre fuera de la ventana se envía en cuanto el contacto vuelve a
          escribir.
        </p>
      )}
      {!loading && !error && provider !== "waha" && usableTemplates.length === 0 && (
        <p className="rounded-md border bg-subtle px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          {templates.length > 0
            ? "Ninguna plantilla aprobada se puede enviar desde aquí: revisa el motivo en la lista."
            : "No hay plantillas aprobadas en este número. Créalas y apruébalas en WhatsApp Manager; al recargar aparecerán aquí."}
        </p>
      )}

      {selected && selected.variableCount > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Variables de la plantilla
          </p>
          {Array.from({ length: selected.variableCount }, (_, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-xs text-muted-foreground">
                {`{{${index + 1}}}`}
              </span>
              <Input
                value={params[index] ?? ""}
                onChange={(event) => {
                  const next = [...params];
                  next[index] = event.target.value;
                  onParamsChange(next);
                }}
                maxLength={1024}
                placeholder={
                  index === 0 ? "{{nombre}} o un valor fijo" : "Valor"
                }
                aria-label={`Variable ${index + 1} de la plantilla`}
              />
            </div>
          ))}
          <p className="text-[11px] leading-snug text-muted-foreground">
            Escribe <code className="rounded bg-subtle px-1">{"{{nombre}}"}</code>{" "}
            como valor para personalizar cada envío con el nombre del contacto.
          </p>
        </div>
      )}

      {selected?.headerMediaRequired && (
        <div className="space-y-1.5">
          <label
            className="text-sm font-medium"
            htmlFor={`${idPrefix}-header-url`}
          >
            Enlace público del encabezado (
            {(selected.headerFormat ?? "IMAGE").toLowerCase()})
          </label>
          <Input
            id={`${idPrefix}-header-url`}
            type="url"
            value={headerMediaUrl}
            onChange={(event) => onHeaderMediaUrlChange(event.target.value)}
            maxLength={2048}
            placeholder="https://…"
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            Meta descarga el archivo desde este enlace al enviar: debe ser https
            y estar accesible sin sesión.
          </p>
          {selected.headerFormat?.toUpperCase() === "IMAGE" &&
            /^https:\/\/\S+$/i.test(headerMediaUrl.trim()) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={headerMediaUrl.trim()}
                alt="Vista previa del encabezado"
                loading="lazy"
                referrerPolicy="no-referrer"
                className="max-h-40 rounded-md border object-cover"
              />
            )}
        </div>
      )}

      {selected && (
        <div className="rounded-lg border bg-background p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
            Vista previa
          </p>
          <p className="whitespace-pre-wrap text-sm">
            {preview ||
              selected.bodyText ||
              "La plantilla no tiene cuerpo de texto."}
          </p>
        </div>
      )}

      {requiresOptIn && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-snug text-amber-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Las plantillas de marketing solo pueden enviarse a contactos que
          autorizaron promociones por WhatsApp. La audiencia se limitará
          automáticamente a quienes tengan ese consentimiento registrado.
        </p>
      )}
    </div>
  );
}
