/**
 * Email Service — buzón Hostinger con IMAP/SMTP.
 *
 * nodemailer para enviar, imapflow para recibir, mailparser para parsear.
 * Cuentas por organización, inbox unificado, threading, match contactos.
 */
import { eq, and, desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { sanitizeHeaderValue } from "@/lib/email-format";


export type EmailAccountInput = {
  label?: string;
  email: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  username: string;
  password: string;
};

/** Crear cuenta de email */
export async function createEmailAccount(
  organizationId: string,
  input: EmailAccountInput
): Promise<string> {
  const db = getDb();
  const id = newId("emailAccount");

  const encryptedPassword = encryptSecret(input.password);

  await db.insert(schema.emailAccount).values({
    id,
    organizationId,
    label: input.label ?? input.email,
    emailAddress: input.email,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    smtpSecure: input.smtpPort === 465,
    smtpUser: input.username,
    smtpPassCipher: encryptedPassword.cipher,
    smtpPassIv: encryptedPassword.iv,
    smtpPassTag: encryptedPassword.tag,
    imapHost: input.imapHost,
    imapPort: input.imapPort,
    imapSecure: input.imapPort === 993,
    imapUser: input.username,
    imapPassCipher: encryptedPassword.cipher,
    imapPassIv: encryptedPassword.iv,
    imapPassTag: encryptedPassword.tag,
  });

  return id;
}

/** Listar cuentas de email de una organización */
export async function listEmailAccounts(organizationId: string) {
  const db = getDb();
  return db
    .select({
      id: schema.emailAccount.id,
      label: schema.emailAccount.label,
      email: schema.emailAccount.emailAddress,
      enabled: schema.emailAccount.enabled,
      imapHost: schema.emailAccount.imapHost,
      imapPort: schema.emailAccount.imapPort,
      smtpHost: schema.emailAccount.smtpHost,
      smtpPort: schema.emailAccount.smtpPort,
      username: schema.emailAccount.smtpUser,
    })
    .from(schema.emailAccount)
    .where(scoped(schema.emailAccount.organizationId, organizationId))
    .orderBy(schema.emailAccount.createdAt);
}

/**
 * `getEmailAccountCredentials` devuelve null también con la cuenta apagada, y
 * decir "no encontrada" mandaba al usuario a buscar una cuenta que sí estaba
 * ahí, solo que con el interruptor en Off.
 */
export const CUENTA_MUDA =
  "La cuenta no existe o está apagada (Ajustes → Email).";

/** Obtener credentials de una cuenta para IMAP/SMTP */
export async function getEmailAccountCredentials(organizationId: string, accountId: string) {
  const db = getDb();
  const [account] = await db
    .select()
    .from(schema.emailAccount)
    .where(scoped(schema.emailAccount.organizationId, organizationId, eq(schema.emailAccount.id, accountId)))
    .limit(1);

  if (!account || !account.enabled) return null;

  const smtpPassword = decryptSecret({
    cipher: account.smtpPassCipher,
    iv: account.smtpPassIv,
    tag: account.smtpPassTag,
  });

  return {
    ...account,
    smtpPassword,
    imapPassword: decryptSecret({ cipher: account.imapPassCipher, iv: account.imapPassIv, tag: account.imapPassTag }),
    smtpUser: account.smtpUser,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    smtpSecure: account.smtpSecure,
    imapUser: account.imapUser,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    imapSecure: account.imapSecure,
  };
}

/** Eliminar cuenta de email */
export async function deleteEmailAccount(organizationId: string, accountId: string) {
  const db = getDb();
  await db
    .delete(schema.emailAccount)
    .where(
      scoped(
        schema.emailAccount.organizationId,
        organizationId,
        eq(schema.emailAccount.id, accountId)
      )
    );
}

/** Sincronizar inbox de una cuenta (fetch IMAP) */
export async function syncInbox(organizationId: string, accountId: string): Promise<number> {
  const creds = await getEmailAccountCredentials(organizationId, accountId);
  if (!creds) throw new Error(CUENTA_MUDA);

  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");

  const client = new ImapFlow({
    host: creds.imapHost,
    port: creds.imapPort,
    secure: creds.imapSecure,
    auth: { user: creds.imapUser, pass: creds.imapPassword },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  let synced = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const db = getDb();
      let processed = 0;
      const MAX_SYNC = 500;

      // Paso 1 (barato): solo el envelope de todo el inbox, para conocer los
      // Message-ID sin descargar cuerpos. El poller corre cada 3 min: bajar el
      // source de los 500 correos en cada barrido es inútil si ya están en BD.
      const unknown: Array<{ seq: number; uid: number }> = [];
      const seenIds = new Set<string>();
      for await (const msg of client.fetch("1:*", { envelope: true, uid: true })) {
        const messageId = msg.envelope?.messageId ?? `${msg.uid}@${accountId}`;
        if (seenIds.has(messageId)) continue;
        seenIds.add(messageId);
        const [existing] = await db
          .select({ id: schema.emailMessage.id })
          .from(schema.emailMessage)
          .where(scoped(schema.emailMessage.organizationId, organizationId, eq(schema.emailMessage.accountId, accountId), eq(schema.emailMessage.messageId, messageId)))
          .limit(1);
        if (!existing) unknown.push({ seq: msg.seq, uid: msg.uid });
        if (unknown.length >= MAX_SYNC) break;
      }

      // Paso 2: el cuerpo solo de los que faltan.
      if (unknown.length > 0) {
        const seqKeys = unknown.map((m) => m.seq);
        for await (const msg of client.fetch(seqKeys, { envelope: true, source: true, uid: true })) {
          if (!msg.source) continue;

          const parsed = await simpleParser(msg.source);
          const messageId = parsed.messageId ?? `${msg.uid}@${accountId}`;

          // Buscar contacto por email del remitente (TODO: asociar cuando schema.contact tenga campo email)
          const contactId: string | null = null;

          await db.insert(schema.emailMessage).values({
            id: newId("emailMessage"),
            organizationId: creds.organizationId,
            accountId,
            messageId,
            threadId: parsed.inReplyTo ?? null,
            from: parsed.from?.value[0]?.address ?? "",
            to: { value: parsed.to?.value ?? [] },
            cc: parsed.cc ? { value: parsed.cc.value } : null,
            subject: parsed.subject ?? "(sin asunto)",
            bodyText: parsed.text ?? null,
            bodyHtml: parsed.html ? String(parsed.html) : null,
            direction: "inbound",
            contactId,
            seen: false,
          }).onConflictDoNothing();

          synced++;
          processed++;
          if (processed >= MAX_SYNC) break;
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    await client.logout().catch(() => {});
    throw err;
  }

  return synced;
}

/**
 * Corresponsal de un correo ya ingerido: en un entrante es el `from`; en un
 * saliente, el primer destinatario que no somos nosotros. Es el mismo criterio
 * con el que el buzón agrupa y rotula los hilos, así que responder "al hilo"
 * siempre apunta al cliente que escribió y no a una dirección tecleada.
 */
export function emailParticipantOf(
  message: { direction: string; from: string; to: unknown },
  ownEmail: string
): { email: string; name: string | null } {
  const entries =
    (message.to as { value?: Array<{ address?: string; name?: string }> } | null)?.value ?? [];
  const own = ownEmail.trim().toLowerCase();
  // Un saliente dirigido sólo a nuestra cuenta (un envío interno, un CC
  // propio) no tiene a quién responder: se devuelve vacío y el llamador decide,
  // en vez de contestarse a sí mismo por el fallback de la primera entrada.
  const isOurs = (address: string | undefined) => !!address && address.trim().toLowerCase() === own;
  const address = message.direction === "inbound"
    ? message.from
    : (entries.find((entry) => entry.address && !isOurs(entry.address))?.address ?? "");
  const label = entries.find((entry) => entry.address === address)?.name?.trim();
  return { email: address.trim(), name: label && label !== address ? label : null };
}

/** Enviar email con nodemailer */
export async function sendEmail(
  organizationId: string,
  accountId: string,
  input: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    inReplyTo?: string;
    contactId?: string | null;
    /** Campaña masiva que originó el envío (auditoría en email_message). */
    campaignId?: string | null;
    attachments?: { filename: string; content: string; contentType: string }[];
  }
): Promise<string> {
  const creds = await getEmailAccountCredentials(organizationId, accountId);
  if (!creds) throw new Error(CUENTA_MUDA);

  const nodemailer = await import("nodemailer");

  const transporter = nodemailer.createTransport({
    host: creds.smtpHost,
    port: creds.smtpPort,
    secure: creds.smtpSecure,
    requireTLS: !creds.smtpSecure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    auth: { user: creds.smtpUser, pass: creds.smtpPassword },
  });

  // Asunto y nombre visible viajan como cabeceras: un CRLF permite añadir un
  // `Bcc:` y desviar el correo. Se limpian aquí, en el único punto por el que
  // pasan todos los envíos (campañas, respuestas, cotizaciones y agente).
  const subject = sanitizeHeaderValue(input.subject, 998);
  const fromName = creds.fromName ? sanitizeHeaderValue(creds.fromName, 255) : "";

  const result = await transporter.sendMail({
    from: fromName
      ? { name: fromName, address: creds.emailAddress }
      : creds.emailAddress,
    to: input.to,
    subject,
    text: input.text,
    html: input.html,
    inReplyTo: input.inReplyTo,
    references: input.inReplyTo ? [input.inReplyTo] : undefined,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content, "base64"),
      contentType: a.contentType,
    })),
  });

  // Guardar mensaje enviado en la base
  const db = getDb();
  const id = newId("emailMessage");

  await db.insert(schema.emailMessage).values({
    id,
    organizationId: creds.organizationId,
    accountId,
    messageId: result.messageId,
    from: creds.emailAddress,
    to: { value: [{ address: input.to, name: "" }] },
    subject,
    bodyText: input.text ?? null,
    bodyHtml: input.html ?? null,
    direction: "outbound",
    contactId: input.contactId ?? null,
    campaignId: input.campaignId ?? null,
    seen: true,
    threadId: input.inReplyTo ?? null,
  });

  return result.messageId;
}

/** Listar mensajes de una cuenta */
export async function listMessages(
  organizationId: string,
  accountId: string,
  opts?: { limit?: number; offset?: number; direction?: string }
) {
  const db = getDb();
  const conditions = [
    scoped(schema.emailMessage.organizationId, organizationId),
    eq(schema.emailMessage.accountId, accountId),
  ];

  if (opts?.direction) {
    conditions.push(eq(schema.emailMessage.direction, opts.direction));
  }

  return db
    .select()
    .from(schema.emailMessage)
    .where(and(...conditions))
    .orderBy(desc(schema.emailMessage.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);
}

/** Obtener un mensaje */
export async function getMessage(organizationId: string, messageId: string) {
  const db = getDb();
  const [msg] = await db
    .select()
    .from(schema.emailMessage)
    .where(
      scoped(
        schema.emailMessage.organizationId,
        organizationId,
        eq(schema.emailMessage.id, messageId)
      )
    )
    .limit(1);

  return msg ?? null;
}
