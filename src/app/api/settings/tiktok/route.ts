import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  getTikTokCredentialsByOrg,
  saveTikTokCredentials,
  tokenLast4,
} from "@/server/tiktok/credentials";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { recordDiagnostic } from "@/server/diagnostics/logger";

export const dynamic = "force-dynamic";

/** Estado de la conexión de TikTok (el token nunca sale entero). */
export const GET = withAuth(async (session) => {
  if (!isChannelEnabled("tiktok")) return channelDisabledResponse();
  const creds = await getTikTokCredentialsByOrg(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      source: creds.source,
      tiktokUserId: creds.tiktokUserId,
      username: creds.username,
      accountRef: creds.accountRef,
      status: creds.status,
      tokenLast4: tokenLast4(creds.token),
    },
  });
});

const putSchema = z.object({
  accountRef: z.string().trim().max(100).min(1),
  tiktokUserId: z.string().trim().max(100).nullish(),
  username: z.string().trim().nullish(),
  token: z.string().trim().min(1),
  webhookSecret: z.string().trim().min(1).nullish(),
});

/**
 * Guarda la conexión validando ANTES contra Zernio: una API key que no
 * sirve no llega a la base.
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (!isChannelEnabled("tiktok")) return channelDisabledResponse();
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const data = body.data;

  const check = await verify(data);
  if (!check.ok) {
    return apiError(check.status, check.code, check.message);
  }

  await saveTikTokCredentials({
    organizationId: session.organizationId,
    tiktokUserId: data.tiktokUserId ?? null,
    username: check.username ?? data.username ?? null,
    accountRef: data.accountRef,
    token: data.token,
    webhookSecret: data.webhookSecret ?? null,
  });

  await recordDiagnostic({
    organizationId: session.organizationId,
    source: "tiktok",
    code: "connection_saved",
    severity: "info",
  });

  return Response.json({ ok: true, username: check.username ?? null });
});

type Check =
  | { ok: true; username: string | null }
  | { ok: false; status: number; code: string; message: string };

async function verify(data: z.infer<typeof putSchema>): Promise<Check> {
  const url = `${process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1"}/inbox/conversations?limit=1`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${data.token}` },
    });
  } catch {
    return {
      ok: false,
      status: 503,
      code: "platform_unavailable",
      message: "No se pudo contactar la plataforma; intenta de nuevo",
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: 422,
      code: "invalid_token",
      message: "La API key de Zernio no es válida",
    };
  }

  return { ok: true, username: null };
}
