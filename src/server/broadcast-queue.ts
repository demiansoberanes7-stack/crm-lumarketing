import { and, asc, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { noConversationReason } from "@/server/broadcasts/audience";
import { refreshBroadcastCampaign } from "@/server/broadcasts/metrics";
import { CUENTA_MUDA, sendEmail } from "@/server/email/service";
import { personalizeEmail } from "@/server/email-campaigns/personalize";
import { SendError, sendTemplate, sendText } from "@/server/inbox/send";
import { templateRequiresOptIn } from "@/server/whatsapp/templates";

const POLL_MS = 2_000;
const BATCH_SIZE = 5;
const STALE_AFTER_MS = 5 * 60_000;
/**
 * Reintento de los envíos que esperan ventana. El camino rápido es el
 * reencolado al recibir un mensaje del cliente; este es el respaldo por si el
 * webhook llegó cuando el worker estaba caído.
 */
const WAIT_RETRY_MS = 60 * 60_000;

/** Cuentas que ya toparon su límite en este ciclo (para no repetir el aviso). */
const dailyLimitWarned = new Set<string>();

const workerState = globalThis as typeof globalThis & {
  __broadcastPoll?: ReturnType<typeof setInterval>;
  __broadcastTick?: boolean;
};

export function broadcastWorkerReady(): boolean {
  return Boolean(workerState.__broadcastPoll);
}

export async function startBroadcastWorker(): Promise<void> {
  if (workerState.__broadcastPoll) return;
  const db = getDb();
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await db
    .select({ organizationId: schema.broadcastRecipient.organizationId, campaignId: schema.broadcastRecipient.campaignId })
    .from(schema.broadcastRecipient)
    .where(and(eq(schema.broadcastRecipient.status, "sending"), lte(schema.broadcastRecipient.updatedAt, staleBefore)));
  await db
    .update(schema.broadcastRecipient)
    .set({
      status: "failed",
      errorCode: "send_interrupted",
      errorMessage: "El proceso se interrumpió durante el envío; verifica el resultado antes de reintentar.",
      updatedAt: new Date(),
    })
    .where(and(eq(schema.broadcastRecipient.status, "sending"), lte(schema.broadcastRecipient.updatedAt, staleBefore)));
  for (const row of stale) await refreshBroadcastCampaign(row.organizationId, row.campaignId);

  workerState.__broadcastPoll = setInterval(() => void runBroadcastWorkerOnce(), POLL_MS);
  workerState.__broadcastPoll.unref?.();
  void runBroadcastWorkerOnce();
}

export async function runBroadcastWorkerOnce(): Promise<void> {
  if (workerState.__broadcastTick) return;
  workerState.__broadcastTick = true;
  try {
    const db = getDb();
    const now = new Date();
    const due = await db
      .select({
        id: schema.broadcastRecipient.id,
        organizationId: schema.broadcastRecipient.organizationId,
        campaignId: schema.broadcastRecipient.campaignId,
        conversationId: schema.broadcastRecipient.conversationId,
        contactId: schema.broadcastRecipient.contactId,
        email: schema.broadcastRecipient.email,
        recipientName: schema.broadcastRecipient.recipientName,
        channel: schema.broadcastRecipient.channel,
        subject: schema.broadcastCampaign.subject,
        senderAccountId: schema.broadcastCampaign.senderAccountId,
        messageText: schema.broadcastCampaign.messageText,
        templateName: schema.broadcastCampaign.templateName,
        templateLanguage: schema.broadcastCampaign.templateLanguage,
        templateParams: schema.broadcastCampaign.templateParams,
        templateCategory: schema.broadcastCampaign.templateCategory,
        templateHeaderFormat: schema.broadcastCampaign.templateHeaderFormat,
        templateHeaderMediaUrl: schema.broadcastCampaign.templateHeaderMediaUrl,
        contactOptInAt: schema.contact.waMarketingOptInAt,
      })
      .from(schema.broadcastRecipient)
      .innerJoin(schema.broadcastCampaign, eq(schema.broadcastCampaign.id, schema.broadcastRecipient.campaignId))
      .leftJoin(schema.contact, eq(schema.contact.id, schema.broadcastRecipient.contactId))
      .where(
        and(
          inArray(schema.broadcastRecipient.status, ["queued", "waiting_window"]),
          eq(schema.broadcastCampaign.status, "sending"),
          lte(schema.broadcastRecipient.scheduledAt, now)
        )
      )
      .orderBy(asc(schema.broadcastRecipient.scheduledAt))
      .limit(BATCH_SIZE);

    for (const recipient of due) {
      const [claimed] = await db
        .update(schema.broadcastRecipient)
        .set({
          status: "sending",
          attempts: sql`${schema.broadcastRecipient.attempts} + 1`,
          startedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            scoped(schema.broadcastRecipient.organizationId, recipient.organizationId, eq(schema.broadcastRecipient.id, recipient.id)),
            inArray(schema.broadcastRecipient.status, ["queued", "waiting_window"])
          )
        )
        .returning({ id: schema.broadcastRecipient.id });
      if (!claimed) continue;
      await deliver(recipient);
    }
  } catch (error) {
    console.error("[broadcasts] Falló el ciclo de envíos masivos:", error);
  } finally {
    dailyLimitWarned.clear();
    workerState.__broadcastTick = false;
  }
}

function templateParamsFrom(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

type DeliveryRow = {
  id: string;
  organizationId: string;
  campaignId: string;
  conversationId: string | null;
  contactId: string | null;
  email: string | null;
  recipientName: string | null;
  /** Columna varchar de la BD: se valida contra el catálogo al crearla. */
  channel: string;
  subject: string | null;
  senderAccountId: string | null;
  messageText: string;
  templateName: string | null;
  templateLanguage: string | null;
  templateParams: unknown;
  templateCategory: string | null;
  templateHeaderFormat: string | null;
  templateHeaderMediaUrl: string | null;
  contactOptInAt: Date | null;
};

async function deliver(input: DeliveryRow) {
  const db = getDb();
  const now = new Date();
  const [campaign] = await db
    .select({ status: schema.broadcastCampaign.status })
    .from(schema.broadcastCampaign)
    .where(scoped(schema.broadcastCampaign.organizationId, input.organizationId, eq(schema.broadcastCampaign.id, input.campaignId)))
    .limit(1);
  if (campaign?.status !== "sending") {
    await db.update(schema.broadcastRecipient)
      .set({ status: "queued", startedAt: null, updatedAt: new Date() })
      .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, input.id)));
    return;
  }
  if (input.channel === "email") {
    await deliverEmail(input);
    return;
  }
  if (!input.conversationId) {
    const reason = noConversationReason(input.channel);
    await db.update(schema.broadcastRecipient)
      .set({ status: "skipped", skipReason: reason, updatedAt: now })
      .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, input.id)));
    await refreshBroadcastCampaign(input.organizationId, input.campaignId);
    return;
  }

  const usesTemplate = input.channel === "whatsapp" && Boolean(input.templateName);
  // Meta exige opt-in para plantillas MARKETING; sin él no se envía.
  if (usesTemplate && templateRequiresOptIn(input.templateCategory) && !input.contactOptInAt) {
    await db.update(schema.broadcastRecipient)
      .set({
        status: "skipped",
        skipReason: "no_marketing_opt_in",
        errorCode: null,
        errorMessage: "El contacto no tiene registrado su opt-in para mensajes de marketing.",
        updatedAt: now,
      })
      .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, input.id)));
    await refreshBroadcastCampaign(input.organizationId, input.campaignId);
    return;
  }

  try {
    const result = usesTemplate
      ? await sendTemplate({
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          templateName: input.templateName!,
          templateLanguage: input.templateLanguage ?? "",
          templateParams: templateParamsFrom(input.templateParams),
          templateCategory: input.templateCategory,
          templateHeaderFormat: input.templateHeaderFormat,
          templateHeaderMediaUrl: input.templateHeaderMediaUrl,
          templateBody: input.messageText,
        })
      : await sendText({
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          text: input.messageText,
        });
    await db.update(schema.broadcastRecipient)
      .set({ status: "sent", messageId: result.messageId, sentAt: new Date(), updatedAt: new Date() })
      .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, input.id)));
  } catch (error) {
    const sendError = error instanceof SendError ? error : null;
    // Fuera de ventana: NO es un fallo definitivo. La fila queda esperando y
    // se reencola cuando el cliente escriba (o al reintento de respaldo).
    if (sendError?.code === "window_closed") {
      await db.update(schema.broadcastRecipient)
        .set({
          status: "waiting_window",
          skipReason: "waiting_window",
          messageId: sendError.messageId ?? null,
          errorCode: sendError.code,
          errorMessage: sendError.message.slice(0, 500),
          scheduledAt: new Date(Date.now() + WAIT_RETRY_MS),
          updatedAt: new Date(),
        })
        .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, input.id)));
    } else {
      await db.update(schema.broadcastRecipient)
        .set({
          status: "failed",
          skipReason: null,
          messageId: sendError?.messageId ?? null,
          errorCode: sendError?.code ?? "send_failed",
          errorMessage: (sendError?.message ?? "No se pudo entregar el mensaje.").slice(0, 500),
          updatedAt: new Date(),
        })
        .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, input.id)));
    }
  }
  await refreshBroadcastCampaign(input.organizationId, input.campaignId);
}

/**
 * Envío de una fila de campaña de correo. Sin conversación ni ventana: el
 * correo no depende del último mensaje del cliente. La cuenta remitente se
 * valida aquí otra vez por si se apagó después de crear la campaña, y se
 * respeta su límite diario: lo que sobra continúa al día siguiente.
 */
async function deliverEmail(input: DeliveryRow): Promise<void> {
  const db = getDb();
  const now = new Date();
  const email = input.email?.trim().toLowerCase() ?? "";
  const fail = async (code: string, message: string) => {
    await db.update(schema.broadcastRecipient)
      .set({ status: "failed", errorCode: code, errorMessage: message.slice(0, 500), updatedAt: now })
      .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, input.id)));
    await refreshBroadcastCampaign(input.organizationId, input.campaignId);
  };

  if (!email) {
    await fail("missing_email", "El destinatario no tiene correo.");
    return;
  }
  if (!input.senderAccountId) {
    await fail("sender_unavailable", "La campaña no tiene cuenta remitente.");
    return;
  }
  const [sender] = await db
    .select({ enabled: schema.emailAccount.enabled, dailyLimit: schema.emailAccount.dailyLimit })
    .from(schema.emailAccount)
    .where(
      scoped(
        schema.emailAccount.organizationId,
        input.organizationId,
        eq(schema.emailAccount.id, input.senderAccountId)
      )
    )
    .limit(1);
  if (!sender?.enabled) {
    await fail("sender_unavailable", CUENTA_MUDA);
    return;
  }
  if (sender.dailyLimit > 0) {
    const used = await senderSentToday(input.organizationId, input.senderAccountId);
    if (used >= sender.dailyLimit) {
      // Se reprograma al siguiente día UTC; la campaña sigue "sending" y el
      // resto de la lista espera su turno en vez de fallar en masa.
      const nextDay = new Date(now);
      nextDay.setUTCHours(24, 1, 0, 0);
      await db.update(schema.broadcastRecipient)
        .set({
          status: "queued",
          startedAt: null,
          errorCode: null,
          errorMessage: null,
          scheduledAt: nextDay,
          updatedAt: now,
        })
        .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, input.id)));
      if (!dailyLimitWarned.has(input.senderAccountId)) {
        dailyLimitWarned.add(input.senderAccountId);
        console.warn(
          `[broadcasts] La cuenta ${input.senderAccountId} alcanzó su límite diario (${sender.dailyLimit}); la campaña continúa mañana.`
        );
      }
      return;
    }
  }

  try {
    const messageId = await sendEmail(input.organizationId, input.senderAccountId, {
      to: email,
      subject: personalizeEmail(input.subject ?? "(sin asunto)", { email, name: input.recipientName }),
      text: personalizeEmail(input.messageText, { email, name: input.recipientName }),
      contactId: input.contactId,
      campaignId: input.campaignId,
    });
    await db.update(schema.broadcastRecipient)
      .set({ status: "sent", messageId, sentAt: new Date(), errorCode: null, errorMessage: null, updatedAt: new Date() })
      .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, input.id)));
  } catch (error) {
    await db.update(schema.broadcastRecipient)
      .set({
        status: "failed",
        errorCode: "send_failed",
        errorMessage: (error instanceof Error ? error.message : "No se pudo enviar el correo.").slice(0, 500),
        updatedAt: new Date(),
      })
      .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, input.id)));
  }
  await refreshBroadcastCampaign(input.organizationId, input.campaignId);
}

/** Correos salientes de la cuenta desde la medianoche UTC. */
async function senderSentToday(organizationId: string, accountId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const [row] = await getDb()
    .select({ total: count() })
    .from(schema.emailMessage)
    .where(
      and(
        scoped(schema.emailMessage.organizationId, organizationId),
        eq(schema.emailMessage.accountId, accountId),
        eq(schema.emailMessage.direction, "outbound"),
        gte(schema.emailMessage.createdAt, start)
      )
    );
  return Number(row?.total ?? 0);
}
