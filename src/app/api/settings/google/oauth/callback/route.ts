import { withOwner } from "@/lib/api";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { googleConnector } from "@/server/agenda/connectors/google";
import { saveGoogleCredentials } from "@/server/agenda/connectors/google-credentials";
import {
  consumeGoogleOAuthState,
  exchangeGoogleAuthCode,
  googleOAuthReturnUrl,
  GoogleOAuthExchangeError,
} from "@/server/agenda/google-oauth";

export const dynamic = "force-dynamic";

/**
 * Vuelta de Google con el `code`. SIEMPRE redirige a la pantalla de ajustes:
 * el dueño no lee respuestas JSON en el navegador, y un error de Google
 * tiene que explicarse en la misma página donde se inició la conexión.
 */
export const GET = withOwner(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();

  const url = new URL(req.url);
  const providerError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const fail = (reason: string) => Response.redirect(googleOAuthReturnUrl(reason), 302);

  if (providerError) return fail(providerError);
  if (!code) return fail("missing_code");

  const pending = await consumeGoogleOAuthState(session.organizationId, state);
  if (!pending) return fail("state_invalid");

  let refreshToken: string;
  try {
    const tokens = await exchangeGoogleAuthCode({
      clientId: pending.clientId,
      clientSecret: pending.clientSecret,
      code,
    });
    refreshToken = tokens.refreshToken;
  } catch (err) {
    return fail(
      err instanceof GoogleOAuthExchangeError ? err.message : "exchange_failed"
    );
  }

  const check = await googleConnector.testConnection({
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    refreshToken,
    calendarId: pending.calendarId,
    status: "connected",
  });
  if (!check.ok) return fail(check.error);

  await saveGoogleCredentials({
    organizationId: session.organizationId,
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    refreshToken,
    calendarId: pending.calendarId,
  });

  return Response.redirect(googleOAuthReturnUrl("ok"), 302);
});
