import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { digitsOnly, normalizeText } from "@/lib/search";
import type { ProspectDto } from "@/lib/types";

/**
 * Prospectos: la vista de todo el que escribió primero.
 *
 * NO es una tabla nueva. Un prospecto es exactamente un contacto con al menos
 * un mensaje entrante en su hilo real, así que los datos ya están en la BD y se
 * derivan en la consulta. Duplicarlos en otra tabla partiría la identidad (el
 * teléfono lo reconcilia `inbox/identity.ts`) y obligaría a mantener sincronizadas
 * dos copias del mismo cliente. Lo que esta pantalla agrega es la lectura: quién
 * habló, por dónde, cuántas veces, cuándo y si dejó su número.
 */

const UNACCENT_FROM = "áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ";
const UNACCENT_TO = "aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC";

/** Corte duro de la lista: es una pantalla de trabajo, no un archivo. */
const LIMIT = 200;

export type ProspectFilter = {
  organizationId: string;
  q?: string;
  channel?: string;
  /** "falta": solo quien aún no deja teléfono; "tiene": los demás. */
  phone?: "falta" | "tiene";
  archived?: boolean;
};

type ProspectRow = {
  contactId: string;
  name: string;
  phone: string | null;
  channel: string;
  conversationId: string;
  archivedAt: Date | null;
  firstInboundAt: Date;
  lastInboundAt: Date;
  inboundCount: number;
  lastInboundText: string | null;
};

type LeadRow = {
  contactId: string;
  stageName: string | null;
  priority: string | null;
  amountCents: number | null;
};

/**
 * El momento real del mensaje: `wa_timestamp` es la hora del cliente, pero hay
 * ingestas que no lo traen y se respaldan en `created_at`. La expresión solo
 * interpola columnas, ningún valor de JS, así que no hay codificador que pueda
 * fallar aquí.
 */
function inboundAt() {
  return sql`COALESCE(${schema.message.waTimestamp}, ${schema.message.createdAt})`;
}

export async function listProspects(
  filter: ProspectFilter
): Promise<ProspectDto[]> {
  const db = getDb();
  const q = filter.q?.trim() ?? "";

  // Mismo criterio tolerante que Contactos: nombre sin acentos ni mayúsculas y
  // teléfono por dígitos, porque la UI lo pinta "+52 462 134…" y la BD lo
  // guarda "52462134…". Los comodines LIKE se escapan para que un "%" tecleado
  // no liste el directorio entero.
  const qDigits = q ? digitsOnly(q) : "";
  const qLike = q ? normalizeText(q).replace(/[\\%_]/g, "\\$&") : "";
  const search = q
    ? or(
        sql`lower(translate(${schema.contact.name}, ${UNACCENT_FROM}, ${UNACCENT_TO}))
            like ${`%${qLike}%`}`,
        // Un dígito suelto barrería la lista completa: mínimo 3.
        qDigits.length >= 3
          ? sql`regexp_replace(coalesce(${schema.contact.phone}, ''), '\\D', '', 'g')
                like ${`%${qDigits}%`}`
          : undefined
      )
    : undefined;

  const rows = (await db
    .select({
      contactId: schema.contact.id,
      name: schema.contact.name,
      phone: schema.contact.phone,
      channel: schema.contact.channel,
      conversationId: schema.conversation.id,
      archivedAt: schema.contact.archivedAt,
      firstInboundAt: sql<Date>`MIN(${inboundAt()})`,
      lastInboundAt: sql<Date>`MAX(${inboundAt()})`,
      inboundCount: sql<number>`count(*)::int`,
      // El último mensaje dicho, no su hora: es lo que le dice al dueño si este
      // prospecto ya dejó su número o sigue pidiendo información.
      lastInboundText: sql<string | null>`(array_agg(${schema.message.text}
        ORDER BY ${inboundAt()} DESC, ${schema.message.id} DESC))[1]`,
    })
    .from(schema.message)
    .innerJoin(
      schema.conversation,
      and(
        eq(schema.message.conversationId, schema.conversation.id),
        eq(schema.conversation.organizationId, filter.organizationId),
        // El hilo de pruebas no es un cliente.
        eq(schema.conversation.isTest, false)
      )
    )
    .innerJoin(
      schema.contact,
      and(
        eq(schema.conversation.contactId, schema.contact.id),
        eq(schema.contact.organizationId, filter.organizationId)
      )
    )
    .where(
      scoped(
        schema.message.organizationId,
        filter.organizationId,
        eq(schema.message.direction, "in"),
        search,
        filter.channel
          ? eq(schema.contact.channel, filter.channel)
          : undefined,
        filter.phone === "falta" ? isNull(schema.contact.phone) : undefined,
        filter.phone === "tiene" ? isNotNull(schema.contact.phone) : undefined,
        filter.archived ? undefined : isNull(schema.contact.archivedAt)
      )
    )
    .groupBy(
      schema.contact.id,
      schema.contact.name,
      schema.contact.phone,
      schema.contact.channel,
      schema.conversation.id,
      schema.contact.archivedAt
    )
    .orderBy(desc(sql`MAX(${inboundAt()})`))
    .limit(LIMIT)) as unknown as ProspectRow[];

  if (rows.length === 0) return [];

  // Etapa de la oportunidad: se consulta aparte (una subconsulta correlacionada
  // aquí choca con el `id` ambiguo de `lead`, igual que en /api/contacts). Un
  // contacto puede tener varias oportunidades; gana la principal y, entre
  // iguales, la más reciente.
  const leadRows = (await db
    .select({
      contactId: schema.lead.contactId,
      stageName: schema.pipelineStage.name,
      priority: schema.lead.priority,
      amountCents: schema.lead.amountCents,
    })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      and(
        eq(schema.pipelineStage.id, schema.lead.stageId),
        // El join también va por tenant: emparejar la etapa de otra
        // organización por su `id` filtraría aquí el mismo hueco que ya se
        // cerró en `getQuote` con la descripción larga del catálogo.
        eq(schema.pipelineStage.organizationId, filter.organizationId)
      )
    )
    .where(
      scoped(
        schema.lead.organizationId,
        filter.organizationId,
        inArray(schema.lead.contactId, rows.map((r) => r.contactId))
      )
    )
    .orderBy(
      desc(schema.lead.isPrimary),
      desc(schema.lead.lastActivityAt),
      desc(schema.lead.createdAt)
    )) as unknown as LeadRow[];

  const leadByContact = new Map<string, LeadRow>();
  for (const row of leadRows) {
    // Ordenado de la más preferida a la menos: la primera que se ve es la buena.
    if (!leadByContact.has(row.contactId)) leadByContact.set(row.contactId, row);
  }

  return rows.map((row) =>
    serializeProspect(row, leadByContact.get(row.contactId) ?? null)
  );
}

export function serializeProspect(
  row: ProspectRow,
  lead?: LeadRow | null
): ProspectDto {
  return {
    contactId: row.contactId,
    name: row.name,
    phone: row.phone,
    channel: row.channel,
    channelLabel: CHANNEL_LABEL[row.channel as Channel] ?? row.channel,
    conversationId: row.conversationId,
    firstInboundAt: row.firstInboundAt?.toISOString() ?? null,
    lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
    inboundCount: row.inboundCount,
    lastInboundText: row.lastInboundText,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    stageName: lead?.stageName ?? null,
    priority: (lead?.priority as ProspectDto["priority"]) ?? null,
    amountCents: lead?.amountCents ?? null,
  };
}
