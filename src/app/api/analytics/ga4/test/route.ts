import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, apiError, parseBody } from "@/lib/api";
import { getIntegration } from "@/server/integrations";
import { testGa4Connection, parseGa4Credentials } from "@/server/analytics/ga4";

export const dynamic = "force-dynamic";

const TestBody = z.object({
  /** Si vienen del formulario se prueban sin guardar; si no, se usan las guardadas. */
  propertyId: z.string().max(64).optional(),
  serviceAccountJson: z.string().max(100_000).optional(),
});

/**
 * Prueba las credenciales de GA4 antes de guardarlas: corre un reporte mínimo
 * (últimos 7 días) contra la Data API y devuelve el mensaje tal cual.
 * El fallo de aquí jamás bloquea nada: es una lectura.
 */
export const POST = withAuth(async (session, req: Request) => {
  const parsed = await parseBody(req, TestBody);
  if (!parsed.ok) return parsed.response;

  let credentials = parseGa4Credentials({
    propertyId: parsed.data.propertyId ?? "",
    serviceAccountJson: parsed.data.serviceAccountJson ?? "",
  });
  if (!credentials) {
    const integration = await getIntegration(session.organizationId, "ga4");
    credentials = integration ? parseGa4Credentials(integration.credentials) : null;
  }
  if (!credentials) {
    return apiError(422, "ga4_not_configured", "Falta el Property ID o el JSON de la service account");
  }

  const result = await testGa4Connection(credentials);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
});
