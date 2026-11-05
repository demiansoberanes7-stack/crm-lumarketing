import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { getBusinessGoogleCredentials } from "@/server/agenda/connectors/google-credentials";
import { startGoogleOAuth } from "@/server/agenda/google-oauth";

export const dynamic = "force-dynamic";

/**
 * Abre el consentimiento de Google para el calendario PERSONAL de quien está en
 * la sesión.
 *
 * Van las MISMAS credenciales de app que usó el negocio: Client ID y Client
 * Secret son del proyecto de Google Cloud de la instancia, así que un miembro no
 * tiene nada que pegar y nada que poder estropear. Lo único suyo es a quién le
 * dice Google «sí, autorizo» — y por eso el `userId` sale de la sesión, se guarda
 * en el estado de un solo uso y el callback lo respeta.
 */
const startSchema = z.object({
  calendarId: z.string().trim().optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const body = await parseBody(req, startSchema);
  if (!body.ok) return body.response;

  const business = await getBusinessGoogleCredentials(session.organizationId);
  if (!business) {
    return apiError(
      409,
      "google_not_connected",
      "El negocio todavía no ha conectado Google Calendar: sin esa app de Google Cloud no hay a quién pedir el permiso."
    );
  }

  const url = await startGoogleOAuth({
    organizationId: session.organizationId,
    clientId: business.clientId,
    clientSecret: business.clientSecret,
    calendarId: body.data.calendarId ?? "primary",
    userId: session.userId,
  });

  return Response.json({ url });
});
