import { z } from "zod";
import { parseBody, withOwner } from "@/lib/api";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { startGoogleOAuth } from "@/server/agenda/google-oauth";

export const dynamic = "force-dynamic";

/**
 * Abre el consentimiento de Google y devuelve la URL a la que ir.
 *
 * El dueño pega solo Client ID y Client Secret (los de SU proyecto de Google
 * Cloud); el refresh token lo obtiene el callback al volver de Google.
 */
const startSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  calendarId: z.string().trim().optional(),
});

export const POST = withOwner(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const body = await parseBody(req, startSchema);
  if (!body.ok) return body.response;

  const url = await startGoogleOAuth({
    organizationId: session.organizationId,
    clientId: body.data.clientId,
    clientSecret: body.data.clientSecret,
    calendarId: body.data.calendarId ?? null,
  });

  return Response.json({ url });
});
