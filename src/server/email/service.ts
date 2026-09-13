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
    })
    .from(schema.emailAccount)
    .where(scoped(schema.emailAccount.organizationId, organizationId))
    .orderBy(schema.emailAccount.createdAt);
}

/** Obtener credentials de una cuenta para IMAP/SMTP */
export async function getEmailAccountCredentials(organizationId: string, accountId: string) {
  const db = getDb();
  const [account] = await db
    .select()
    .from(schema.emailAccount)
    .where(scoped(schema.emailAccount.organizationId, organizationId, eq(schema.emailAccount.id, accountId)))
    .limit(1);

  if (!account) return null;

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
  if (!creds) throw new Error("Cuenta no encontrada");

  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");

  const client = new ImapFlow({
    host: creds.imapHost,
    port: creds.imapPort,
    secure: creds.imapSecure,
    auth: { user: creds.imapUser, pass: creds.imapPassword },
    logger: false,
  });

  let synced = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const messages = client.fetch("1:*", {
        envelope: true,
        source: true,
        uid: true,
      });

      const db = getDb();

      for await (const msg of messages) {
        if (!msg.source) continue;

        const parsed = await simpleParser(msg.source);
        const messageId = parsed.messageId ?? `${msg.uid}@${accountId}`;

        // Verificar si ya existe
        const [existing] = await db
          .select({ id: schema.emailMessage.id })
          .from(schema.emailMessage)
          .where(scoped(schema.emailMessage.organizationId, organizationId, eq(schema.emailMessage.accountId, accountId), eq(schema.emailMessage.messageId, messageId)))
          .limit(1);

        if (existing) continue;

        // Buscar contacto por email del remitente
        let contactId: string | null = null;
        if (parsed.from?.value[0]?.address) {
          // El schema de contact no tiene campo email, por ahora no asociamos
          contactId = null;
        }

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
        });

        synced++;
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
  }
): Promise<string> {
  const creds = await getEmailAccountCredentials(organizationId, accountId);
  if (!creds) throw new Error("Cuenta no encontrada");

  const nodemailer = await import("nodemailer");

  const transporter = nodemailer.createTransport({
    host: creds.smtpHost,
    port: creds.smtpPort,
    secure: creds.smtpSecure,
    auth: { user: creds.smtpUser, pass: creds.smtpPassword },
  });

  const result = await transporter.sendMail({
    from: creds.emailAddress,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    inReplyTo: input.inReplyTo,
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
    subject: input.subject,
    bodyText: input.text ?? null,
    bodyHtml: input.html ?? null,
    direction: "outbound",
    contactId: null,
    seen: true,
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
