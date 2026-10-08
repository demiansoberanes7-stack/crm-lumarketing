import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { getIntegration, type IntegrationProvider } from "@/server/integrations";
import {
  testGa4ConnectionState,
  testGoogleAdsConnection,
  testMetaAdsConnection,
} from "@/server/integrations/test-connection";

export const dynamic = "force-dynamic";

/**
 * Prueba la conexión de una integración del Marketing.
 *
 * Si el body trae campos, se prueban ESOS (así se verifica antes de guardar);
 * si viene vacío, se prueban los guardados — es lo que usa el auto-test al
 * abrir la pantalla. La respuesta trae el ESTADO, no solo ok/error: la tarjeta
 * se pone verde solo cuando el proveedor respondió de verdad.
 */
const Body = z.object({
  customerId: z.string().max(64).optional(),
  developerToken: z.string().max(4096).optional(),
  clientId: z.string().max(512).optional(),
  clientSecret: z.string().max(1024).optional(),
  accessToken: z.string().max(4096).optional(),
  adAccountId: z.string().max(128).optional(),
  propertyId: z.string().max(64).optional(),
  serviceAccountJson: z.string().max(100_000).optional(),
});

const PROVIDERS = ["google_ads", "meta_ads", "ga4"] as const;
type Provider = (typeof PROVIDERS)[number];

/** Solo lo no vacío del body manda: un campo en blanco no pisa lo guardado. */
function merge(
  stored: Record<string, unknown>,
  incoming: z.infer<typeof Body>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value === "string") out[key] = value;
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === "string" && value.trim()) out[key] = value;
  }
  return out;
}

export const POST = withAuth(
  async (session, req: Request, { params }: { params: Promise<{ provider: string }> }) => {
    const provider = (await params).provider as Provider;
    if (!PROVIDERS.includes(provider)) {
      return apiError(404, "not_found", "Proveedor no soportado");
    }

    const raw = (await req.text().catch(() => "")).trim();
    let parsedBody: unknown = {};
    if (raw) {
      try {
        parsedBody = JSON.parse(raw);
      } catch {
        return apiError(422, "invalid_body", "El body debe ser JSON válido");
      }
    }
    const body = Body.safeParse(parsedBody);
    if (!body.success) {
      return apiError(
        422,
        "invalid_body",
        body.error.issues.map((i) => i.message).join("; ")
      );
    }

    const integration = await getIntegration(
      session.organizationId,
      provider as IntegrationProvider
    );
    const creds = merge(integration?.credentials ?? {}, body.data);

    const result =
      provider === "meta_ads"
        ? await testMetaAdsConnection({
            accessToken: creds.accessToken ?? "",
            adAccountId: creds.adAccountId ?? "",
          })
        : provider === "google_ads"
          ? await testGoogleAdsConnection({
              customerId: creds.customerId ?? "",
              developerToken: creds.developerToken ?? "",
              clientId: creds.clientId ?? "",
              clientSecret: creds.clientSecret ?? "",
            })
          : await testGa4ConnectionState({
              propertyId: creds.propertyId ?? "",
              serviceAccountJson: creds.serviceAccountJson ?? "",
            });

    return Response.json(result);
  }
);
