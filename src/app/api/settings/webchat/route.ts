import { z } from "zod";
import { parseBody, withOwner } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { webchatSnippet, type WebchatSettings } from "@/lib/webchat";
import {
  ensureWebchatKey,
  getWebchatSettings,
  saveWebchatSettings,
} from "@/server/webchat/settings";

export const dynamic = "force-dynamic";

/**
 * Configuración del chat del sitio (owner). La llave pública NUNCA se acepta
 * del cliente: se genera en el servidor la primera vez y solo se rota cuando
 * el dueño lo pide explícitamente (`rotateKey`), porque cambiarla invalida el
 * snippet que ya está pegado en su web.
 */
export const GET = withOwner(async (session) => {
  const stored = await getWebchatSettings(session.organizationId);
  // La llave se crea al abrir la pantalla para que el snippet esté disponible
  // sin obligar al dueño a «guardar» antes de poder copiarlo.
  const settings =
    stored.publicKey === ""
      ? await saveWebchatSettings(session.organizationId, ensureWebchatKey(stored))
      : stored;
  return Response.json({
    settings,
    snippet: webchatSnippet(getEnv().APP_BASE_URL, settings.publicKey),
  });
});

const putSchema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().max(60).optional(),
  welcome: z.string().trim().max(300).optional(),
  allowedOrigins: z.array(z.string().trim().max(200)).max(10).optional(),
  rotateKey: z.boolean().optional(),
});

export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const current = await getWebchatSettings(session.organizationId);
  const next: WebchatSettings = {
    enabled: body.data.enabled,
    publicKey: body.data.rotateKey ? "" : current.publicKey,
    allowedOrigins: body.data.allowedOrigins ?? current.allowedOrigins,
    title: body.data.title || current.title,
    welcome: body.data.welcome || current.welcome,
  };
  const saved = await saveWebchatSettings(session.organizationId, next);
  return Response.json({
    settings: saved,
    snippet: webchatSnippet(getEnv().APP_BASE_URL, saved.publicKey),
  });
});
