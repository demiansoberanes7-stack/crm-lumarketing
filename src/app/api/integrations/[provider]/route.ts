import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, apiError } from "@/lib/api";
import { getIntegration, saveIntegration, deleteIntegration, type IntegrationProvider } from "@/server/integrations";

export const dynamic = "force-dynamic";

/**
 * Solo los tres proveedores del Marketing Hub se leen/guardan por esta ruta.
 * `automation_rules` vive en su propio endpoint (`/api/automations/rules`),
 * que ya valida las reglas con su esquema; dejarlo aquí significaría
 * escribir reglas sin pasar por esa validación.
 */
const PROVIDER_SCHEMAS = {
  google_ads: z.object({
    customerId: z.string().max(64),
    developerToken: z.string().max(4096),
    clientId: z.string().max(512),
    clientSecret: z.string().max(1024),
    /** Opcional: pegado tras autorizar una vez con scope adwords (patrón Calendar). */
    refreshToken: z.string().max(1024).optional(),
  }),
  meta_ads: z.object({
    accessToken: z.string().max(4096),
    adAccountId: z.string().max(128),
  }),
  ga4: z.object({
    propertyId: z.string().max(64),
    /** JSON de la service account; vacío/ausente = conservar el guardado. */
    serviceAccountJson: z.string().max(100_000).optional(),
  }),
} satisfies Partial<Record<IntegrationProvider, z.ZodTypeAny>>;

type MarketingProvider = keyof typeof PROVIDER_SCHEMAS;

function resolveProvider(raw: string): MarketingProvider | null {
  return (Object.keys(PROVIDER_SCHEMAS) as string[]).includes(raw)
    ? (raw as MarketingProvider)
    : null;
}

/** Últimos 4 caracteres de un secreto, para que el formulario sepa que hay uno guardado. */
function last4(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value.slice(-4) : "";
}

export const GET = withAuth(
  async (session, _req: Request, { params }: { params: Promise<{ provider: string }> }) => {
    const provider = resolveProvider((await params).provider);
    if (!provider) return apiError(404, "not_found", "Proveedor no soportado");
    const integration = await getIntegration(session.organizationId, provider);
    if (!integration) return NextResponse.json(null);
    const credentials: Record<string, unknown> = { ...integration.credentials };
    // Los secretos jamás cruzan al cliente (constitución I): el formulario
    // solo recibe los últimos 4 caracteres / banderas, igual que el resto del
    // CRM (tokenLast4). Un campo vacío al guardar no borra lo guardado.
    if (provider === "ga4") {
      const configured = typeof credentials.serviceAccountJson === "string" &&
        credentials.serviceAccountJson.trim().length > 0;
      delete credentials.serviceAccountJson;
      credentials.serviceAccountConfigured = configured;
    } else if (provider === "google_ads") {
      credentials.developerTokenLast4 = last4(credentials.developerToken);
      credentials.clientSecretLast4 = last4(credentials.clientSecret);
      credentials.refreshTokenSet = last4(credentials.refreshToken).length > 0;
      delete credentials.developerToken;
      delete credentials.clientSecret;
      delete credentials.refreshToken;
    } else if (provider === "meta_ads") {
      credentials.accessTokenLast4 = last4(credentials.accessToken);
      delete credentials.accessToken;
    }
    return NextResponse.json({ credentials });
  }
);

export const POST = withAuth(
  async (session, req: Request, { params }: { params: Promise<{ provider: string }> }) => {
    const provider = resolveProvider((await params).provider);
    if (!provider) return apiError(404, "not_found", "Proveedor no soportado");

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return apiError(422, "invalid_body", "El body debe ser JSON válido");
    }
    const result = PROVIDER_SCHEMAS[provider].safeParse(raw);
    if (!result.success) {
      const detail = result.error.issues
        .map(i => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; ");
      return apiError(422, "invalid_body", detail);
    }
    const data = result.data as Record<string, unknown>;

    // Un campo vacío no borra lo que ya existe (mismo criterio que /test): el
    // formulario ya no recibe los secretos guardados, así que los deja en
    // blanco para conservarlos.
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string" && !value.trim()) delete data[key];
    }

    const existing = await getIntegration(session.organizationId, provider);
    // Merge sobre lo guardado: un campo vacío no borra lo que ya existe
    // (el formulario no vuelve a enviar los secretos que no tocaste).
    const credentials: Record<string, unknown> = {
      ...(existing?.credentials ?? {}),
      ...data,
    };
    if (provider === "ga4") {
      const incoming = data.serviceAccountJson;
      const stored = existing?.credentials.serviceAccountJson;
      if (typeof incoming !== "string" || incoming.trim().length === 0) {
        if (typeof stored === "string" && stored.length > 0) {
          credentials.serviceAccountJson = stored;
        } else {
          delete credentials.serviceAccountJson;
        }
      }
    }
    await saveIntegration(session.organizationId, provider, credentials);
    return NextResponse.json({ ok: true });
  }
);

export const DELETE = withAuth(
  async (session, _req: Request, { params }: { params: Promise<{ provider: string }> }) => {
    const provider = resolveProvider((await params).provider);
    if (!provider) return apiError(404, "not_found", "Proveedor no soportado");
    await deleteIntegration(session.organizationId, provider);
    return NextResponse.json({ ok: true });
  }
);
