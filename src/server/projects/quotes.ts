import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { ProjectError } from "./errors";

/**
 * Cotizaciones anidadas en un proyecto YA creado.
 *
 * Hasta ahora el vínculo solo se escribía al crear el proyecto desde la
 * cotización (`createProject` / `acceptQuoteIntoProjectTx`). Si el proyecto ya
 * existía, no había forma de anidarle una cotización posterior — y el expediente
 * quedaba sin el papel comercial que lo respalda. Aquí está ese verbo: ligar y
 * desligar, sin tocar los importes de ninguno de los dos lados.
 *
 * Regla de negocio que impone la BD: `project_quote_org_quote_uq` permite UN
 * proyecto por cotización. No se relajó la restricción; se le dio una respuesta
 * clara al usuario (409 con el folio del otro proyecto).
 */

/** Cotizaciones anidadas en el proyecto, con folio, estado e importe. */
export async function listProjectQuotes(organizationId: string, projectId: string) {
  const rows = await getDb()
    .select({
      id: schema.projectQuote.id,
      quoteId: schema.projectQuote.quoteId,
      quoteNumber: schema.quote.quoteNumber,
      status: schema.quote.status,
      total: schema.quote.total,
      currency: schema.quote.currency,
      contactName: schema.contact.name,
      linkedAt: schema.projectQuote.linkedAt,
    })
    .from(schema.projectQuote)
    .innerJoin(
      schema.quote,
      sql`${schema.quote.id} = ${schema.projectQuote.quoteId} AND ${schema.quote.organizationId} = ${organizationId}`
    )
    .leftJoin(
      schema.contact,
      sql`${schema.contact.id} = ${schema.quote.contactId} AND ${schema.contact.organizationId} = ${organizationId}`
    )
    .where(
      scoped(
        schema.projectQuote.organizationId,
        organizationId,
        eq(schema.projectQuote.projectId, projectId)
      )
    )
    .orderBy(asc(schema.projectQuote.linkedAt));

  return rows;
}

/**
 * Anida una cotización. Idempotente: anidar la misma cotización en el mismo
 * proyecto dos veces no duplica ni falla; anidarla en OTRO proyecto sí.
 */
export async function linkProjectQuote(
  organizationId: string,
  projectId: string,
  quoteId: string
): Promise<{ alreadyLinked: boolean }> {
  const db = getDb();

  const [quote] = await db
    .select({
      id: schema.quote.id,
      quoteNumber: schema.quote.quoteNumber,
      archivedAt: schema.quote.archivedAt,
    })
    .from(schema.quote)
    .where(scoped(schema.quote.organizationId, organizationId, eq(schema.quote.id, quoteId)))
    .limit(1);
  if (!quote) throw new ProjectError(404, "Cotización no encontrada");
  if (quote.archivedAt) {
    throw new ProjectError(422, `La cotización ${quote.quoteNumber} está archivada`);
  }

  const [existing] = await db
    .select({ projectId: schema.projectQuote.projectId })
    .from(schema.projectQuote)
    .where(
      scoped(
        schema.projectQuote.organizationId,
        organizationId,
        eq(schema.projectQuote.quoteId, quoteId)
      )
    )
    .limit(1);
  if (existing) {
    if (existing.projectId === projectId) return { alreadyLinked: true };
    throw new ProjectError(
      409,
      `La cotización ${quote.quoteNumber} ya está anidada en otro proyecto`
    );
  }

  const inserted = await db
    .insert(schema.projectQuote)
    .values({
      id: newId("projectQuote"),
      organizationId,
      projectId,
      quoteId,
      linkedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: schema.projectQuote.id });
  // Carrera contra otra pestaña que ganó el índice único.
  if (inserted.length === 0) {
    throw new ProjectError(409, `La cotización ${quote.quoteNumber} ya tiene un proyecto vinculado`);
  }

  return { alreadyLinked: false };
}

/** Desanidar: borra solo el vínculo, no la cotización ni el proyecto. */
export async function unlinkProjectQuote(
  organizationId: string,
  projectId: string,
  quoteId: string
): Promise<void> {
  const rows = await getDb()
    .delete(schema.projectQuote)
    .where(
      scoped(
        schema.projectQuote.organizationId,
        organizationId,
        eq(schema.projectQuote.projectId, projectId),
        eq(schema.projectQuote.quoteId, quoteId)
      )
    )
    .returning({ id: schema.projectQuote.id });
  if (rows.length === 0) {
    throw new ProjectError(404, "Esa cotización no está anidada en este proyecto");
  }
}
