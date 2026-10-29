import { apiError, withOwner } from "@/lib/api";
import { getEnv } from "@/lib/env";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { getMessengerCredentialsByOrg } from "@/server/messenger/credentials";
import {
  inspectZernioDelivery,
  repairZernioDelivery,
  type DeliveryInspection,
  type RepairResult,
} from "@/server/zernio/delivery";

export const dynamic = "force-dynamic";

/**
 * 017 — Estado y reparación de la ENTREGA del webhook de Messenger.
 *
 * Es distinto de `/api/settings/webhook`, que solo compone la URL que hay que
 * pegar en Meta o en Zernio. Aquí se pregunta a Zernio qué tiene REGISTRADO de
 * verdad y se prueba el camino completo. Sin esto, «el webhook está configurado»
 * y «los mensajes entran» no se podían distinguir: si nada llega, la base queda
 * vacía y no hay nada que mirar.
 *
 * La llave de Zernio se usa solo en el servidor y nunca sale en la respuesta.
 */

function messengerWebhookUrl(): string {
  const env = getEnv();
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  return `${base}/api/webhooks/messenger/${env.META_WEBHOOK_VERIFY_TOKEN}`;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export const GET = withOwner(async (session) => {
  if (!isChannelEnabled("messenger")) return channelDisabledResponse();

  const creds = await getMessengerCredentialsByOrg(session.organizationId);
  if (!creds) {
    return apiError(409, "not_connected", "Messenger no está conectado en este negocio");
  }
  if (creds.source !== "zernio") {
    return Response.json({ source: "meta", supported: false });
  }

  let inspection: DeliveryInspection;
  try {
    inspection = await inspectZernioDelivery({
      token: creds.token,
      expectedUrl: messengerWebhookUrl(),
    });
  } catch (err) {
    // Un fallo al consultar NO es «todo bien»: se dice explícitamente.
    return Response.json({
      source: "zernio",
      supported: true,
      checked: false,
      error: errorMessage(err, "No se pudo consultar la configuración en Zernio"),
    });
  }

  return Response.json({ source: "zernio", supported: true, checked: true, ...inspection });
});

/**
 * Corrige la configuración en Zernio: registra el endpoint si falta, lo apunta
 * a esta instalación si quedó en un host o un token viejos, lo reactiva si
 * Zernio lo desactivó por fallos y sincroniza el secreto que el CRM espera.
 * Después manda una entrega de prueba, que es la prueba real de que funciona.
 */
export const POST = withOwner(async (session) => {
  if (!isChannelEnabled("messenger")) return channelDisabledResponse();

  const creds = await getMessengerCredentialsByOrg(session.organizationId);
  if (!creds) {
    return apiError(409, "not_connected", "Messenger no está conectado en este negocio");
  }
  if (creds.source !== "zernio") {
    return apiError(
      422,
      "unsupported_source",
      "Esta reparación solo aplica cuando los mensajes llegan por Zernio"
    );
  }

  const expectedUrl = messengerWebhookUrl();
  let name: string;
  try {
    name = `Zorro Tech CRM (${new URL(expectedUrl).host})`.slice(0, 50);
  } catch {
    return apiError(500, "bad_base_url", "APP_BASE_URL no es una URL válida");
  }

  let result: RepairResult;
  try {
    result = await repairZernioDelivery({
      token: creds.token,
      expectedUrl,
      secret: creds.webhookSecret,
      name,
    });
  } catch (err) {
    return Response.json({
      source: "zernio",
      supported: true,
      repaired: false,
      error: errorMessage(err, "No se pudo registrar el webhook en Zernio"),
    });
  }

  return Response.json({ source: "zernio", supported: true, repaired: true, ...result });
});
