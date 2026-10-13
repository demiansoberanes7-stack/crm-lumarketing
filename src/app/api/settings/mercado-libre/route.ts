import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { isChannelEnabled } from "@/server/channels/enabled";
import {
  deleteMarketplaceCredentials,
  getMarketplaceCredentials,
  saveMarketplaceAccessToken,
  saveMarketplaceCredentials,
  saveMarketplaceRefreshToken,
} from "@/server/mercado-libre/credentials";
import {
  getMe,
  listUnreadPacks,
  refreshAccessToken,
} from "@/server/mercado-libre/client";

export const dynamic = "force-dynamic";

/** Credenciales OAuth de Mercado Libre. Patrón Google Business: pegar tokens, sin callback. */

function disabledResponse() {
  return apiError(404, "channel_disabled", "El canal de Mercado Libre está apagado en esta instancia");
}

export const GET = withOwner(async (session) => {
  if (!isChannelEnabled("mercado_libre")) return disabledResponse();
  const creds = await getMarketplaceCredentials(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      status: creds.status,
      clientId: creds.clientId,
      userId: creds.userId,
      siteId: creds.siteId,
      clientSecretLast4: creds.clientSecret.slice(-4),
      refreshTokenSet: Boolean(creds.refreshToken),
      lastPolledAt: creds.lastPolledAt,
    },
  });
});

const credsSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  refreshToken: z.string().trim().min(1),
});

export const PUT = withOwner(async (session, req: Request) => {
  if (!isChannelEnabled("mercado_libre")) return disabledResponse();
  const body = await parseBody(req, credsSchema);
  if (!body.ok) return body.response;

  // Verificación real antes de guardar: refresca el token y consulta el
  // vendedor autenticado — si el dueño pegó algo malo, lo sabe aquí y no se
  // persiste nada.
  const token = await refreshAccessToken(body.data);
  if ("error" in token) {
    return apiError(422, "mercado_libre_invalid", `Mercado Libre rechazó las credenciales: ${token.error}`);
  }
  const me = await getMe(token.token.accessToken);
  if ("error" in me) {
    return apiError(422, "mercado_libre_invalid", `No se pudo identificar la cuenta vendedora: ${me.error}`);
  }

  await saveMarketplaceCredentials({
    organizationId: session.organizationId,
    clientId: body.data.clientId,
    clientSecret: body.data.clientSecret,
    // Si ML rotó el refresh token en el intercambio, guardamos el nuevo.
    refreshToken: token.token.refreshToken ?? body.data.refreshToken,
    userId: me.userId,
    siteId: me.siteId,
  });
  await saveMarketplaceAccessToken(
    session.organizationId,
    token.token.accessToken,
    token.token.expiresIn
  );
  if (token.token.refreshToken && token.token.refreshToken !== body.data.refreshToken) {
    await saveMarketplaceRefreshToken(session.organizationId, token.token.refreshToken);
  }

  // Una lectura de los pendientes confirma que el scope de mensajería está
  // bien: el dueño ve de inmediato si la app tiene acceso a los mensajes.
  const unread = await listUnreadPacks(token.token.accessToken);
  const packs = "error" in unread ? null : unread.packIds.length;

  return Response.json({
    ok: true,
    vendor: { userId: me.userId, siteId: me.siteId },
    unreadPacks: packs,
    ...(packs === null && "error" in unread ? { unreadError: unread.error } : {}),
  });
});

export const DELETE = withOwner(async (session) => {
  if (!isChannelEnabled("mercado_libre")) return disabledResponse();
  await deleteMarketplaceCredentials(session.organizationId);
  return Response.json({ ok: true });
});
