import { withAuth } from "@/lib/api";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { googleConnector } from "@/server/agenda/connectors/google";
import {
  saveGoogleCredentials,
} from "@/server/agenda/connectors/google-credentials";
import { syncPendingBookings } from "@/server/agenda/bookings-sync";
import { syncPendingTasks } from "@/server/agenda/tasks-sync";
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
 *
 * Escribe el calendario que el ESTADO pidió escribir, no el que diga el
 * navegador: por eso corre con `withAuth` (antes era `withOwner` y un miembro
 * no podía conectar el suyo) y por eso se comprueba a quién pertenece ese
 * estado. Un miembro no puede desconectar ni sobrescribir la conexión del
 * negocio, y el dueño no puede apropiarse del calendario personal de nadie.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();

  const url = new URL(req.url);
  const providerError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const fail = (reason: string, userId?: string | null) =>
    Response.redirect(googleOAuthReturnUrl(reason, userId), 302);

  if (providerError) return fail(providerError);
  if (!code) return fail("missing_code");

  const pending = await consumeGoogleOAuthState(session.organizationId, state);
  if (!pending) return fail("state_invalid");

  // El estado dice qué calendario es; la sesión dice quién vuelve.
  const forUser =
    pending.userId === null ? null : session.userId === pending.userId ? pending.userId : undefined;
  if (forUser === undefined) return fail("state_invalid");
  if (forUser === null && session.role !== "owner") return fail("state_invalid");

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
      err instanceof GoogleOAuthExchangeError ? err.message : "exchange_failed",
      forUser
    );
  }

  const check = await googleConnector.testConnection({
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    refreshToken,
    calendarId: pending.calendarId,
    status: "connected",
  });
  if (!check.ok) return fail(check.error, forUser);

  await saveGoogleCredentials({
    organizationId: session.organizationId,
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    refreshToken,
    calendarId: pending.calendarId,
    userId: forUser,
  });

  // Reconectar es el momento natural para recuperar lo que se quedó sin evento
  // mientras el token estaba revocado. Conecta el NEGOCIO: se rellenan todas las
  // tareas de la organización, porque cada una se resuelve contra el calendario de
  // su dueño. Conecta un MIEMBRO: el relleno se limita a SUS tareas —completar su
  // OAuth no debe escribir las tareas de sus compañeros en el calendario del
  // negocio; eso le corresponde al poller y al dueño. Si la sincronización está
  // apagada (el default al conectar), no sale nada.
  await syncPendingTasks(session.organizationId, 100, forUser).catch(() => ({
    synced: 0,
    failed: 0,
  }));
  // Las citas van siempre al calendario del negocio, así que solo tienen relleno
  // cuando lo que se acaba de conectar es ese calendario.
  if (forUser === null) {
    await syncPendingBookings(session.organizationId).catch(() => ({
      synced: 0,
      failed: 0,
    }));
  }

  return Response.redirect(googleOAuthReturnUrl("ok", forUser), 302);
});
