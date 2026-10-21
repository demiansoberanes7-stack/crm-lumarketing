import { graphRequest, MetaApiError } from "@/lib/meta/client";
import { zernioFetch } from "@/server/zernio";
import { whatsappProvider } from "@/server/whatsapp/provider";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import {
  getWhatsappZernio,
  zernioWhatsappEnabled,
} from "@/server/whatsapp/zernio-credentials";

/**
 * Plantillas de WhatsApp.
 *
 * Fuera de la ventana de 24 h, Meta solo acepta mensajes iniciados por el
 * negocio si son plantillas aprobadas (`type: "template"`). Las de categoría
 * MARKETING exigen además opt-in previo del contacto; las UTILITY se atan a
 * una transacción existente. El núcleo de campañas no inventa esa política:
 * lista las plantillas del proveedor y deja que la cola aplique la regla.
 *
 * WAHA no maneja plantillas (es un dispositivo vinculado, no la Cloud API):
 * en ese proveedor la lista queda vacía y la campaña sigue el camino de texto
 * libre, que ya ignora la ventana por decisión histórica del producto.
 */

export type WhatsappTemplate = {
  id: string;
  name: string;
  language: string;
  /** MARKETING | UTILITY | AUTHENTICATION, en mayúsculas. */
  category: string | null;
  status: string;
  bodyText: string;
  /** Cantidad de variables posicionales `{{n}}` del cuerpo. */
  variableCount: number;
  /** TEXT | IMAGE | VIDEO | DOCUMENT | LOCATION (null si no hay encabezado). */
  headerFormat: string | null;
  headerText: string;
  /** El encabezado exige un enlace público (imagen, video o documento). */
  headerMediaRequired: boolean;
  /**
   * Motivo por el que la plantilla no se puede enviar desde campañas (null si
   * sí se puede). Protege contra guardar envíos condenados a fallar.
   */
  automationIssue: string | null;
};

type RawButton = {
  type?: string;
  text?: string;
  url?: string;
  phone_number?: string;
};

type RawComponent = {
  type?: string;
  text?: string;
  format?: string;
  parameters?: unknown;
  buttons?: RawButton[];
};

type RawTemplate = {
  id?: string;
  name?: string;
  /** Meta manda el código; Zernio puede mandar `{ code }`. */
  language?: string | { code?: string };
  status?: string;
  category?: string;
  components?: RawComponent[];
};

function asTemplateList(payload: unknown): RawTemplate[] {
  if (Array.isArray(payload)) return payload as RawTemplate[];
  if (payload && typeof payload === "object") {
    const row = payload as { data?: unknown; templates?: unknown };
    if (Array.isArray(row.data)) return row.data as RawTemplate[];
    if (Array.isArray(row.templates)) return row.templates as RawTemplate[];
  }
  return [];
}

function normalizeLanguage(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const code = (value as { code?: unknown }).code;
    if (typeof code === "string") return code.trim();
  }
  return "";
}

/** Cuenta variables posicionales; `{{2}}` implica dos parámetros. */
export function countTemplateVariables(bodyText: string): number {
  let max = 0;
  for (const match of bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const index = Number(match[1]);
    if (Number.isFinite(index) && index > max) max = index;
  }
  return max;
}

/** Sustituye `{{1}}…{{n}}` por los valores; deja intactas las que falten. */
export function renderTemplateText(
  bodyText: string,
  params: readonly string[]
): string {
  return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, rawIndex: string) => {
    const value = params[Number(rawIndex) - 1];
    return value === undefined ? whole : value;
  });
}

/**
 * Personalización por destinatario. Meta no permite nombres de variable (solo
 * números), así que el operador escribe `{{nombre}}` como VALOR del parámetro
 * y aquí se reemplaza por el nombre del contacto en cada envío.
 */
export function personalizeTemplateParams(
  params: readonly string[],
  contactName: string | null | undefined
): string[] {
  const name = contactName?.trim() || "cliente";
  return params.map((param) =>
    param.replace(/\{\{\s*nombre\s*\}\}/gi, name)
  );
}

export type TemplateHeaderMedia = {
  /** IMAGE | VIDEO | DOCUMENT. */
  format: string;
  /** URL pública https del archivo. */
  url: string;
};

/**
 * Componentes de envío: encabezado multimedia (si aplica) y parámetros del
 * cuerpo, en el orden que espera Meta.
 */
export function buildTemplateComponents(
  params: readonly string[],
  header?: TemplateHeaderMedia | null
): Record<string, unknown>[] {
  const components: Record<string, unknown>[] = [];
  if (header) {
    const key = header.format.toLowerCase();
    components.push({
      type: "header",
      parameters: [{ type: key, [key]: { link: header.url } }],
    });
  }
  if (params.length > 0) {
    components.push({
      type: "body",
      parameters: params.map((text) => ({ type: "text", text })),
    });
  }
  return components;
}

/** ¿El texto trae variables posicionales `{{n}}`? */
function hasTemplateVariables(value: string | undefined): boolean {
  return typeof value === "string" && /\{\{\s*\d+\s*\}\}/.test(value);
}

export function normalizeTemplate(raw: RawTemplate): WhatsappTemplate | null {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const language = normalizeLanguage(raw.language);
  if (!name || !language) return null;
  const body = raw.components?.find(
    (component) => component.type?.toUpperCase() === "BODY"
  );
  const bodyText = typeof body?.text === "string" ? body.text : "";
  const header = raw.components?.find(
    (component) => component.type?.toUpperCase() === "HEADER"
  );
  const headerFormat = header
    ? (header.format?.toUpperCase() ?? "TEXT")
    : null;
  const headerText = typeof header?.text === "string" ? header.text : "";
  const headerMediaRequired =
    headerFormat === "IMAGE" ||
    headerFormat === "VIDEO" ||
    headerFormat === "DOCUMENT";
  const buttons = raw.components?.find(
    (component) => component.type?.toUpperCase() === "BUTTONS"
  );

  // Lo que este envío no sabe construir se rechaza al crear la campaña, no
  // cuando cada destinatario ya falló.
  let automationIssue: string | null = null;
  if (headerFormat === "LOCATION") {
    automationIssue = "encabezado de ubicación no soportado";
  } else if (
    headerFormat &&
    !["TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat)
  ) {
    automationIssue = `encabezado ${headerFormat} no soportado`;
  } else if (hasTemplateVariables(headerText)) {
    automationIssue = "el encabezado tiene variables";
  } else if (
    buttons?.buttons?.some(
      (button) =>
        hasTemplateVariables(button.url) ||
        hasTemplateVariables(button.phone_number) ||
        hasTemplateVariables(button.text)
    )
  ) {
    automationIssue = "los botones tienen variables";
  }

  return {
    id: typeof raw.id === "string" ? raw.id : `${name}:${language}`,
    name,
    language,
    category:
      typeof raw.category === "string" ? raw.category.toUpperCase() : null,
    status:
      typeof raw.status === "string" ? raw.status.toUpperCase() : "APPROVED",
    bodyText,
    variableCount: countTemplateVariables(bodyText),
    headerFormat,
    headerText,
    headerMediaRequired,
    automationIssue,
  };
}

function approvedOnly(templates: WhatsappTemplate[]): WhatsappTemplate[] {
  return templates.filter((template) => template.status === "APPROVED");
}

async function listMetaTemplates(
  organizationId: string
): Promise<WhatsappTemplate[]> {
  const credentials = await getCredentialsByOrg(organizationId);
  if (!credentials) {
    throw new MetaApiError("No hay número de WhatsApp conectado", {
      status: 409,
    });
  }
  const response = await graphRequest<{ data?: RawTemplate[] }>(
    `${encodeURIComponent(credentials.wabaId)}/message_templates?` +
      "fields=id,name,language,status,category,components&limit=200",
    { token: credentials.token }
  );
  return approvedOnly(
    (response.data ?? [])
      .map(normalizeTemplate)
      .filter((template): template is WhatsappTemplate => template !== null)
  );
}

async function listZernioTemplates(
  organizationId: string
): Promise<WhatsappTemplate[]> {
  if (!zernioWhatsappEnabled()) {
    throw new MetaApiError("WhatsApp Zernio está desactivado", { status: 409 });
  }
  const credentials = await getWhatsappZernio(organizationId);
  if (!credentials) {
    throw new MetaApiError("Configura WhatsApp Zernio en Ajustes", {
      status: 409,
    });
  }
  const response = await zernioFetch(
    `/whatsapp/templates?accountId=${encodeURIComponent(credentials.accountId)}&status=APPROVED`,
    { token: credentials.token }
  );
  return approvedOnly(
    asTemplateList(response)
      .map(normalizeTemplate)
      .filter((template): template is WhatsappTemplate => template !== null)
  );
}

/**
 * Plantillas aprobadas que el negocio puede usar hoy. WAHA devuelve lista
 * vacía: su transporte no conoce el concepto de plantilla.
 */
export async function listWhatsappTemplates(
  organizationId: string
): Promise<WhatsappTemplate[]> {
  const provider = await whatsappProvider(organizationId);
  if (provider === "waha") return [];
  return provider === "zernio"
    ? listZernioTemplates(organizationId)
    : listMetaTemplates(organizationId);
}

export async function findApprovedWhatsappTemplate(
  organizationId: string,
  name: string,
  language: string
): Promise<WhatsappTemplate | null> {
  const templates = await listWhatsappTemplates(organizationId);
  return (
    templates.find(
      (template) => template.name === name && template.language === language
    ) ?? null
  );
}

export function templateRequiresOptIn(
  category: string | null | undefined
): boolean {
  return (category ?? "").toUpperCase() === "MARKETING";
}

