import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  EMAIL_AUDIENCE_LIMIT,
  normalizeEmail,
  normalizeRecipientList,
  parseRecipientText,
  type EmailRecipient,
  type EmailRecipientInput,
} from "@/server/email-campaigns/recipients";

export type EmailAudienceKind = "contacts" | "mailbox" | "list";

export type EmailAudienceInput = {
  kind: EmailAudienceKind;
  /** Solo para `list`: destinatarios ya leídos de un archivo. */
  recipients?: EmailRecipientInput[];
  /** Solo para `list`: direcciones pegadas a mano o texto CSV. */
  text?: string;
};

export class EmailAudienceError extends Error {
  constructor(readonly code: "audience_empty" | "audience_limit", message: string) {
    super(message);
    this.name = "EmailAudienceError";
  }
}

const CONTACT_EMAIL = sql<string>`nullif(lower(trim(${schema.contact.ficha}->>'email')), '')`;
const MESSAGE_EMAIL = sql<string>`nullif(lower(trim(${schema.emailMessage.from})), '')`;
const LOOKS_LIKE_EMAIL = sql<boolean>`${CONTACT_EMAIL} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`;
const MESSAGE_LOOKS_LIKE_EMAIL = sql<boolean>`${MESSAGE_EMAIL} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`;

/** Correos propios: un remitente del buzón nunca debe recibir la campaña. */
async function ownAddresses(organizationId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ email: schema.emailAccount.emailAddress })
    .from(schema.emailAccount)
    .where(scoped(schema.emailAccount.organizationId, organizationId));
  return rows
    .map((row) => normalizeEmail(row.email))
    .filter((email): email is string => Boolean(email));
}

/** Contactos activos con correo en su ficha, deduplicados por dirección. */
export async function contactEmailRecipients(organizationId: string): Promise<EmailRecipient[]> {
  const rows = await getDb()
    .selectDistinctOn([CONTACT_EMAIL], {
      email: CONTACT_EMAIL,
      name: schema.contact.name,
      contactId: schema.contact.id,
    })
    .from(schema.contact)
    .where(
      and(
        scoped(schema.contact.organizationId, organizationId),
        isNull(schema.contact.archivedAt),
        LOOKS_LIKE_EMAIL
      )
    )
    .orderBy(CONTACT_EMAIL, schema.contact.createdAt)
    .limit(EMAIL_AUDIENCE_LIMIT + 1);
  return rows.flatMap((row) => {
    const email = normalizeEmail(row.email ?? "");
    return email ? [{ email, name: row.name?.trim() || null, contactId: row.contactId }] : [];
  });
}

/** Remitentes distintos que ya escribieron al buzón, sin nuestras propias cuentas. */
export async function mailboxEmailRecipients(organizationId: string): Promise<EmailRecipient[]> {
  const own = await ownAddresses(organizationId);
  const conditions = [
    scoped(schema.emailMessage.organizationId, organizationId),
    eq(schema.emailMessage.direction, "inbound"),
    MESSAGE_LOOKS_LIKE_EMAIL,
    ...(own.length > 0
      ? [sql`${MESSAGE_EMAIL} not in (${sql.join(own.map((address) => sql`${address}`), sql`, `)})`]
      : []),
  ];
  const rows = await getDb()
    .select({
      email: MESSAGE_EMAIL,
      lastMessageAt: sql<Date>`max(${schema.emailMessage.createdAt})`,
    })
    .from(schema.emailMessage)
    .where(and(...conditions))
    .groupBy(MESSAGE_EMAIL)
    .orderBy(desc(sql`max(${schema.emailMessage.createdAt})`))
    .limit(EMAIL_AUDIENCE_LIMIT + 1);
  return rows.flatMap((row) => {
    const email = normalizeEmail(row.email ?? "");
    return email ? [{ email, name: null, contactId: null }] : [];
  });
}

export function listEmailRecipients(input: { recipients?: EmailRecipientInput[]; text?: string }): EmailRecipient[] {
  if (input.recipients?.length) return normalizeRecipientList(input.recipients);
  if (input.text?.trim()) return parseRecipientText(input.text).recipients;
  return [];
}

/**
 * Resuelve la audiencia completa de la campaña. Lanza si excede el límite;
 * una audiencia vacía se devuelve como [] para que la API decida el mensaje.
 */
export async function resolveEmailAudience(
  organizationId: string,
  input: EmailAudienceInput
): Promise<EmailRecipient[]> {
  let recipients: EmailRecipient[];
  if (input.kind === "contacts") {
    recipients = await contactEmailRecipients(organizationId);
  } else if (input.kind === "mailbox") {
    recipients = await mailboxEmailRecipients(organizationId);
  } else {
    recipients = listEmailRecipients(input);
  }
  if (recipients.length > EMAIL_AUDIENCE_LIMIT) {
    throw new EmailAudienceError(
      "audience_limit",
      `La audiencia supera el límite de ${EMAIL_AUDIENCE_LIMIT.toLocaleString("es-MX")} correos por campaña`
    );
  }
  return recipients;
}

export type EmailAudienceCounts = { contacts: number; mailbox: number };

/** Conteos para la pantalla, sin traer las direcciones de la base. */
export async function emailAudienceCounts(organizationId: string): Promise<EmailAudienceCounts> {
  const db = getDb();
  const [contacts] = await db
    .select({ total: sql<number>`count(distinct ${CONTACT_EMAIL})` })
    .from(schema.contact)
    .where(
      and(
        scoped(schema.contact.organizationId, organizationId),
        isNull(schema.contact.archivedAt),
        LOOKS_LIKE_EMAIL
      )
    );
  const own = await ownAddresses(organizationId);
  const mailboxConditions = [
    scoped(schema.emailMessage.organizationId, organizationId),
    eq(schema.emailMessage.direction, "inbound"),
    MESSAGE_LOOKS_LIKE_EMAIL,
    ...(own.length > 0
      ? [sql`${MESSAGE_EMAIL} not in (${sql.join(own.map((address) => sql`${address}`), sql`, `)})`]
      : []),
  ];
  const [mailbox] = await db
    .select({ total: sql<number>`count(distinct ${MESSAGE_EMAIL})` })
    .from(schema.emailMessage)
    .where(and(...mailboxConditions));
  return {
    contacts: Number(contacts?.total ?? 0),
    mailbox: Number(mailbox?.total ?? 0),
  };
}
