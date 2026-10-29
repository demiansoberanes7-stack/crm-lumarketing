import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { readLimitedBody, requestClientKey } from "@/lib/http/body";
import { checkDistributedRateLimit, checkRateLimit } from "@/lib/rate-limit";
import {
  normalizeOrigin,
  WEBCHAT_TEXT_MAX,
  WEBCHAT_VISITOR_PATTERN,
} from "@/lib/webchat";
import { ingestInboundMessage } from "@/server/inbox/ingest";
import { WEB_PREFIX } from "@/server/inbox/identity";
import { maybeRunAgentTurn } from "@/server/ai/trigger";
import { findWebchatOrganization } from "@/server/webchat/settings";

export const dynamic = "force-dynamic";

/**
 * Mensajes del chat del sitio: superficie PÚBLICA.
 *
 * Dos decisiones gobiernan este archivo:
 *
 * 1. El visitante no tiene sesión ni credenciales. Su navegador genera un
 *    identificador aleatorio (`visitor`) la primera vez y lo guarda; ese valor
 *    es, en la práctica, la llave de SU hilo — con él se lee y se escribe, y
 *    sin él no se ve nada. Por eso todo se resuelve buscando el contacto
 *    `web:<visitor>` DENTRO de la organización dueña de `publicKey`: una llave
 *    desconocida no cae en «la primera organización».
 *
 * 2. El turno del agente corre DESPUÉS de contestarle al visitante (`after`).
 *    Esperar la respuesta del modelo antes de devolver el 202 dejaba el
 *    compositor del sitio colgado 5–15 s por mensaje.
 */

type Params = { params: Promise<{ publicKey: string }> };

const sendSchema = z.object({
  visitorId: z.string().regex(WEBCHAT_VISITOR_PATTERN),
  text: z.string().trim().min(1).max(WEBCHAT_TEXT_MAX),
  name: z.string().trim().max(60).optional(),
  clientMessageId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/).optional(),
});

const SEND_RATE = { windowMs: 60_000, max: 30 };
const VISITOR_RATE = { windowMs: 60_000, max: 12 };
const POLL_RATE = { windowMs: 60_000, max: 400 };
const MESSAGE_PAGE = 60;

/**
 * Origen permitido. Vacío = cualquiera (útil para probar el snippet antes de
 * fijar la lista). Un `Origin` ausente se acepta: el iframe del widget es del
 * mismo origen que la API y los navegadores no envían la cabecera en un GET
 * del mismo sitio.
 */
function originAllowed(settings: { allowedOrigins: string[] }, req: Request): boolean {
  if (settings.allowedOrigins.length === 0) return true;
  const raw = req.headers.get("origin");
  if (!raw) return true;
  const origin = normalizeOrigin(raw);
  return origin !== null && settings.allowedOrigins.includes(origin);
}

export async function POST(req: Request, { params }: Params) {
  const { publicKey } = await params;
  const found = await findWebchatOrganization(publicKey);
  if (!found || !found.settings.enabled) {
    return apiError(404, "not_found", "Este chat no está disponible");
  }
  if (!originAllowed(found.settings, req)) {
    return apiError(403, "origin_not_allowed", "Este sitio no está autorizado para usar el chat");
  }

  const client = requestClientKey(req);
  const ipLimit = await checkDistributedRateLimit(`webchat:ip:${publicKey}:${client}`, SEND_RATE);
  if (!ipLimit.allowed) return apiError(429, "rate_limited", "Demasiados mensajes; espera un momento");

  const raw = await readLimitedBody(req, 8192);
  if (raw === null) return apiError(413, "payload_too_large", "El mensaje es demasiado largo");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw || "{}");
  } catch {
    return apiError(422, "invalid_body", "El body debe ser JSON válido");
  }
  const parsed = sendSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return apiError(422, "invalid_body", "Revisa el mensaje: falta el identificador o el texto no es válido");
  }
  const { visitorId, name, clientMessageId } = parsed.data;
  const text = parsed.data.text;
  // zod cuenta caracteres; el límite del canal está en bytes y con acentos y
  // emojis el margen real es menor de lo que aparenta.
  if (Buffer.byteLength(text, "utf8") > WEBCHAT_TEXT_MAX) {
    return apiError(422, "text_too_long", `El mensaje supera ${WEBCHAT_TEXT_MAX} bytes: acórtalo`);
  }

  const visitorLimit = await checkDistributedRateLimit(
    `webchat:visitor:${publicKey}:${visitorId}`,
    VISITOR_RATE
  );
  if (!visitorLimit.allowed) {
    return apiError(429, "rate_limited", "Espera un momento antes de enviar otro mensaje");
  }

  // Idempotencia: un reintento del navegador (red inestable) reutiliza el mismo
  // `clientMessageId` y el UNIQUE de wa_message_id lo descarta.
  const waMessageId = `wc:${visitorId}:${clientMessageId ?? randomUUID()}`;

  const ingested = await ingestInboundMessage({
    organizationId: found.organizationId,
    identity: {
      identity: `${WEB_PREFIX}${visitorId}`,
      channel: "webchat",
      phone: null,
      waUserId: null,
      profileName: name?.trim() || "Visitante del sitio",
    },
    waMessageId,
    type: "text",
    text,
    timestamp: String(Math.floor(Date.now() / 1000)),
    // El turno del agente se lanza abajo, fuera de la respuesta.
    suppressAi: true,
  });
  if (!ingested) {
    return apiError(500, "ingest_failed", "No se pudo guardar el mensaje");
  }

  after(() => maybeRunAgentTurn(ingested.conversationId));

  return Response.json({ ok: true }, { status: 202 });
}

/**
 * Hilo del visitante. Devuelve siempre la última página en vez de aceptar un
 * cursor: el widget la pide cada pocos segundos y fusiona por id, así que un
 * mensaje perdido por una respuesta cortada reaparece en la siguiente vuelta.
 */
export async function GET(req: Request, { params }: Params) {
  const { publicKey } = await params;
  const found = await findWebchatOrganization(publicKey);
  if (!found || !found.settings.enabled) {
    return apiError(404, "not_found", "Este chat no está disponible");
  }

  const visitorId = new URL(req.url).searchParams.get("visitor") ?? "";
  if (!WEBCHAT_VISITOR_PATTERN.test(visitorId)) {
    return apiError(422, "invalid_visitor", "Identificador de visitante no válido");
  }

  const pollLimit = checkRateLimit(`webchat:poll:${publicKey}:${requestClientKey(req)}`, POLL_RATE);
  if (!pollLimit.allowed) return apiError(429, "rate_limited", "Demasiadas consultas");

  const db = getDb();
  const rows = await db
    .select({ conversationId: schema.conversation.id })
    .from(schema.contact)
    .innerJoin(
      schema.conversation,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      and(
        eq(schema.contact.organizationId, found.organizationId),
        eq(schema.contact.channel, "webchat"),
        eq(schema.contact.waIdentity, `${WEB_PREFIX}${visitorId}`),
        eq(schema.conversation.organizationId, found.organizationId)
      )
    )
    .limit(1);
  const conversationId = rows[0]?.conversationId;
  if (!conversationId) {
    return Response.json({ messages: [] }, { headers: { "cache-control": "no-store" } });
  }

  const messages = await db
    .select({
      id: schema.message.id,
      direction: schema.message.direction,
      text: schema.message.text,
      createdAt: schema.message.createdAt,
      waTimestamp: schema.message.waTimestamp,
    })
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(MESSAGE_PAGE);

  return Response.json(
    {
      messages: messages
        .map((m) => ({
          id: m.id,
          direction: m.direction,
          text: m.text,
          createdAt: (m.waTimestamp ?? m.createdAt).toISOString(),
        }))
        .reverse(),
    },
    { headers: { "cache-control": "no-store" } }
  );
}
