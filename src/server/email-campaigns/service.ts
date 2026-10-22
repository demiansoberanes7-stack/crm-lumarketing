import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { CUENTA_MUDA } from "@/server/email/service";
import { EmailAudienceError, resolveEmailAudience } from "@/server/email-campaigns/audience";
import type { CreateEmailCampaignInput } from "@/server/email-campaigns/schema";
import { EMAIL_AUDIENCE_LIMIT } from "@/server/email-campaigns/recipients";

export class EmailCampaignError extends Error {
  constructor(
    readonly code:
      | "sender_not_found"
      | "sender_disabled"
      | "audience_empty"
      | "audience_limit",
    message: string,
    readonly status: number = 422
  ) {
    super(message);
    this.name = "EmailCampaignError";
  }
}

export type SenderAccountOption = {
  id: string;
  label: string;
  emailAddress: string;
  fromName: string | null;
  enabled: boolean;
  dailyLimit: number;
};

/** Cuentas de correo configuradas; la UI deshabilita las apagadas. */
export async function listSenderAccounts(organizationId: string): Promise<SenderAccountOption[]> {
  return getDb()
    .select({
      id: schema.emailAccount.id,
      label: schema.emailAccount.label,
      emailAddress: schema.emailAccount.emailAddress,
      fromName: schema.emailAccount.fromName,
      enabled: schema.emailAccount.enabled,
      dailyLimit: schema.emailAccount.dailyLimit,
    })
    .from(schema.emailAccount)
    .where(scoped(schema.emailAccount.organizationId, organizationId))
    .orderBy(schema.emailAccount.label);
}

export type EmailCampaignSummary = {
  id: string;
  name: string;
  subject: string | null;
  status: string;
  senderAccountId: string | null;
  senderLabel: string | null;
  senderEmail: string | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

/** Campañas de correo (canal 'email') de la organización, más recientes primero. */
export async function listEmailCampaigns(organizationId: string): Promise<EmailCampaignSummary[]> {
  const rows = await getDb()
    .select({
      id: schema.broadcastCampaign.id,
      name: schema.broadcastCampaign.name,
      subject: schema.broadcastCampaign.subject,
      status: schema.broadcastCampaign.status,
      senderAccountId: schema.broadcastCampaign.senderAccountId,
      senderLabel: schema.emailAccount.label,
      senderEmail: schema.emailAccount.emailAddress,
      recipientCount: schema.broadcastCampaign.recipientCount,
      sentCount: schema.broadcastCampaign.sentCount,
      failedCount: schema.broadcastCampaign.failedCount,
      skippedCount: schema.broadcastCampaign.skippedCount,
      scheduledAt: schema.broadcastCampaign.scheduledAt,
      startedAt: schema.broadcastCampaign.startedAt,
      completedAt: schema.broadcastCampaign.completedAt,
      createdAt: schema.broadcastCampaign.createdAt,
    })
    .from(schema.broadcastCampaign)
    .leftJoin(schema.emailAccount, eq(schema.emailAccount.id, schema.broadcastCampaign.senderAccountId))
    .where(
      and(
        scoped(schema.broadcastCampaign.organizationId, organizationId),
        eq(schema.broadcastCampaign.channel, "email")
      )
    )
    .orderBy(desc(schema.broadcastCampaign.createdAt))
    .limit(100);
  return rows.map((row) => ({
    ...row,
    scheduledAt: row.scheduledAt?.toISOString() ?? row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Crea la campaña y su lista de destinatarios en una sola transacción.
 * Nace en borrador: enviar es una acción explícita desde la lista.
 */
export async function createEmailCampaign(input: {
  organizationId: string;
  actorUserId: string;
  data: CreateEmailCampaignInput;
}): Promise<{ id: string; recipientCount: number; senderEmail: string }> {
  const db = getDb();
  const [sender] = await db
    .select({
      id: schema.emailAccount.id,
      emailAddress: schema.emailAccount.emailAddress,
      enabled: schema.emailAccount.enabled,
    })
    .from(schema.emailAccount)
    .where(
      scoped(
        schema.emailAccount.organizationId,
        input.organizationId,
        eq(schema.emailAccount.id, input.data.senderAccountId)
      )
    )
    .limit(1);
  if (!sender) {
    throw new EmailCampaignError(
      "sender_not_found",
      "La cuenta remitente no existe en esta organización.",
      404
    );
  }
  if (!sender.enabled) {
    throw new EmailCampaignError("sender_disabled", CUENTA_MUDA);
  }

  let recipients;
  try {
    recipients = await resolveEmailAudience(input.organizationId, input.data.audience);
  } catch (error) {
    if (error instanceof EmailAudienceError) {
      throw new EmailCampaignError(error.code, error.message);
    }
    throw error;
  }
  if (recipients.length === 0) {
    throw new EmailCampaignError(
      "audience_empty",
      "La audiencia no contiene correos válidos. Revisa la carga o elige otra fuente."
    );
  }
  if (recipients.length > EMAIL_AUDIENCE_LIMIT) {
    throw new EmailCampaignError(
      "audience_limit",
      `La audiencia supera el límite de ${EMAIL_AUDIENCE_LIMIT} correos por campaña`
    );
  }

  const id = newId("broadcastCampaign");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(schema.broadcastCampaign).values({
      id,
      organizationId: input.organizationId,
      name: input.data.name,
      channel: "email",
      senderAccountId: sender.id,
      subject: input.data.subject,
      messageText: input.data.bodyText,
      filters: {
        audienceKind: input.data.audience.kind,
        audienceCount: recipients.length,
      },
      status: "draft",
      recipientCount: recipients.length,
      scheduledAt: now,
      createdBy: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    });
    for (let offset = 0; offset < recipients.length; offset += 500) {
      await tx.insert(schema.broadcastRecipient).values(
        recipients.slice(offset, offset + 500).map((recipient) => ({
          id: newId("broadcastRecipient"),
          organizationId: input.organizationId,
          campaignId: id,
          contactId: recipient.contactId,
          email: recipient.email,
          recipientName: recipient.name,
          channel: "email",
          status: "queued",
          scheduledAt: now,
          createdAt: now,
          updatedAt: now,
        }))
      );
    }
  });

  return { id, recipientCount: recipients.length, senderEmail: sender.emailAddress };
}
