import { count, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { CreateEmailTemplateInput } from "@/server/email-campaigns/schema";

/** Tope de plantillas por negocio y de filas que devuelve la lista. */
export const EMAIL_TEMPLATE_LIMIT = 100;

export class EmailTemplateError extends Error {
  constructor(
    readonly code: "template_limit",
    message: string,
    readonly status: number = 422
  ) {
    super(message);
    this.name = "EmailTemplateError";
  }
}

export type EmailTemplateSummary = {
  id: string;
  name: string;
  subject: string;
  /** Longitud del HTML en caracteres, para mostrarla sin enviarlo entero. */
  htmlLength: number;
  createdAt: string;
};

export type EmailTemplateDetail = EmailTemplateSummary & { html: string };

const htmlLength = sql<number>`length(${schema.emailTemplate.html})`.mapWith(Number);

/** Plantillas del negocio, más recientes primero. Sin el HTML: pesa. */
export async function listEmailTemplates(organizationId: string): Promise<EmailTemplateSummary[]> {
  const rows = await getDb()
    .select({
      id: schema.emailTemplate.id,
      name: schema.emailTemplate.name,
      subject: schema.emailTemplate.subject,
      htmlLength,
      createdAt: schema.emailTemplate.createdAt,
    })
    .from(schema.emailTemplate)
    .where(scoped(schema.emailTemplate.organizationId, organizationId))
    .orderBy(desc(schema.emailTemplate.createdAt))
    .limit(EMAIL_TEMPLATE_LIMIT);
  return rows.map((row) => ({
    ...row,
    htmlLength: Number(row.htmlLength),
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Una plantilla de la organización; un id ajeno se comporta como inexistente. */
export async function getEmailTemplate(
  organizationId: string,
  id: string
): Promise<EmailTemplateDetail | null> {
  const [row] = await getDb()
    .select({
      id: schema.emailTemplate.id,
      name: schema.emailTemplate.name,
      subject: schema.emailTemplate.subject,
      html: schema.emailTemplate.html,
      createdAt: schema.emailTemplate.createdAt,
    })
    .from(schema.emailTemplate)
    .where(scoped(schema.emailTemplate.organizationId, organizationId, eq(schema.emailTemplate.id, id)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    html: row.html,
    htmlLength: row.html.length,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createEmailTemplate(input: {
  organizationId: string;
  actorUserId: string;
  data: CreateEmailTemplateInput;
}): Promise<EmailTemplateSummary> {
  const db = getDb();
  const [existing] = await db
    .select({ total: count() })
    .from(schema.emailTemplate)
    .where(scoped(schema.emailTemplate.organizationId, input.organizationId));
  if (Number(existing?.total ?? 0) >= EMAIL_TEMPLATE_LIMIT) {
    throw new EmailTemplateError(
      "template_limit",
      `Ya tienes ${EMAIL_TEMPLATE_LIMIT} plantillas. Elimina alguna antes de guardar otra.`
    );
  }

  const id = newId("emailTemplate");
  const now = new Date();
  await db.insert(schema.emailTemplate).values({
    id,
    organizationId: input.organizationId,
    name: input.data.name,
    subject: input.data.subject,
    html: input.data.html,
    createdBy: input.actorUserId,
    createdAt: now,
    updatedAt: now,
  });
  return {
    id,
    name: input.data.name,
    subject: input.data.subject,
    htmlLength: input.data.html.length,
    createdAt: now.toISOString(),
  };
}

/** Borra con el filtro de organización: un id ajeno no borra nada. */
export async function deleteEmailTemplate(
  organizationId: string,
  id: string
): Promise<boolean> {
  const deleted = await getDb()
    .delete(schema.emailTemplate)
    .where(scoped(schema.emailTemplate.organizationId, organizationId, eq(schema.emailTemplate.id, id)))
    .returning({ id: schema.emailTemplate.id });
  return deleted.length > 0;
}
