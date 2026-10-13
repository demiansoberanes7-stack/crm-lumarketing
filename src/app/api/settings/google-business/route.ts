import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import {
  googleBusinessDisabledResponse,
  googleBusinessEnabled,
} from "@/server/google-business/flag";
import {
  deleteGoogleBusinessCredentials,
  getGoogleBusinessCredentials,
  saveGoogleBusinessCredentials,
} from "@/server/google-business/credentials";
import { exchangeAccessToken, listAccounts } from "@/server/google-business/google-api";

export const dynamic = "force-dynamic";

/** Credenciales OAuth de Google Business. Patrón Calendar: pegar tokens, sin callback. */

export const GET = withOwner(async (session) => {
  if (!googleBusinessEnabled()) return googleBusinessDisabledResponse();
  const creds = await getGoogleBusinessCredentials(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      status: creds.status,
      clientId: creds.clientId,
      clientSecretLast4: creds.clientSecret.slice(-4),
      refreshTokenSet: Boolean(creds.refreshToken),
      lastSyncedAt: creds.lastSyncedAt,
    },
  });
});

const credsSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  refreshToken: z.string().trim().min(1),
});

export const PUT = withOwner(async (session, req: Request) => {
  if (!googleBusinessEnabled()) return googleBusinessDisabledResponse();
  const body = await parseBody(req, credsSchema);
  if (!body.ok) return body.response;

  // Verificación real antes de guardar: intercambia el refresh token y lista
  // cuentas — si el dueño pegó algo malo, lo sabe aquí y no se persiste nada.
  const token = await exchangeAccessToken(body.data);
  if ("error" in token) {
    return apiError(422, "google_business_invalid", `Google rechazó las credenciales: ${token.error}`);
  }
  const accounts = await listAccounts(token);
  if ("error" in accounts) {
    return apiError(422, "google_business_invalid", `No se pudieron listar las cuentas: ${accounts.error}`);
  }

  await saveGoogleBusinessCredentials({
    organizationId: session.organizationId,
    ...body.data,
  });
  return Response.json({ ok: true, accounts: accounts.accounts });
});

export const DELETE = withOwner(async (session) => {
  if (!googleBusinessEnabled()) return googleBusinessDisabledResponse();
  await deleteGoogleBusinessCredentials(session.organizationId);
  return Response.json({ ok: true });
});
