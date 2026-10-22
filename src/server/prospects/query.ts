import { and, desc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import { getDb, schema } from "@/lib/db";
import { descNullsLast } from "@/lib/db/order";
import { scoped } from "@/lib/db/tenant";
import { digitsOnly, normalizeText } from "@/lib/search";
import { listDismissals, emailKey } from "@/server/prospects/dismiss";
import type { ProspectDto } from "@/lib/types";

/**
 * Prospectos: la vista de todo el que escribió primero.
 *
 * NO es una tabla nueva. Un prospecto es cualquiera que dejó al menos un mensaje
 * entrante, venga por donde venga:
 * - **chat** (WhatsApp, Messenger, Instagram, TikTok, comentarios, Mercado
 *   Libre): un contacto con un mensaje `direction = 'in'` en su hilo real;
 * - **correo**: un remitente de `email_message` con `direction = 'inbound'`.
 *
 * Lo de los datos ya está en la BD y se deriva en la consulta. Duplicarlos en
 * otra tabla partiría la identidad (el teléfono lo reconcilia
 * `inbox/identity.ts`) y obligaría a mantener sincronizadas dos copias del mismo
 * cliente. Lo que esta pantalla agrega es la lectura: quién habló, por dónde,
 * cuántas veces, cuándo y si dejó su número.
 *
 * El correo vive en su propia tabla y su ingesta **no** crea contacto
 * (`email_message.contact_id` se queda en NULL), así que esos prospectos no
 * tienen `contactId` ni hilo en Bandeja: son personas que escribieron y aún no
 * tienen ficha. Es exactamente lo que el dueño pidió ver aquí —«todo mensaje
 * entrante», no solo quien dejó su número— y por eso la fila existe aunque no
 * se pueda abrir en la Bandeja.
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
  archivedAt: Date | string | null;
  firstInboundAt: Date | string | null;
  lastInboundAt: Date | string | null;
  inboundCount: number;
  lastInboundText: string | null;
};

type LeadRow = {
  contactId: string;
  stageName: string | null;
  priority: string | null;
  amountCents: number | null;
};

type EmailProspectRow = {
  email: string;
  firstInboundAt: Date | string | null;
  lastInboundAt: Date | string | null;
  inboundCount: number;
  lastSubject: string | null;
};

/**
 * El correo no es un `Channel` del inbox: no tiene hilo en Bandeja ni agente
 * propio, y meterlo en ese catálogo obligaría a contestar exhaustivos de
 * canales que no lo esperan. Aquí es solo una etiqueta de pantalla.
 */
const EMAIL_CHANNEL = "email";
const EMAIL_CHANNEL_LABEL = "Correo";

/**
 * El momento real del mensaje: `wa_timestamp` es la hora del cliente, pero hay
 * ingestas que no lo traen y se respaldan en `created_at`. La expresión solo
 * interpola columnas, ningún valor de JS, así que no hay codificador que pueda
 * fallar aquí.
 */
function inboundAt() {
  return sql`COALESCE(${schema.message.waTimestamp}, ${schema.message.createdAt})`;
}

/**
 * Fechas de la lista, admitiendo lo que realmente trae el driver.
 *
 * `ProspectRow` declaraba `Date` y el `as unknown as ProspectRow[]` del cast
 * tapaba la duda, pero en producción la pestaña reventó con
 * `b.firstInboundAt?.toISOString is not a function`: el valor llegó sin método.
 * Un fragmento `sql` no tiene columna ni `mapWith()` que lo obligue, así que su
 * tipo depende del driver y de cómo drizzle lo decodifique, no de la anotación
 * de TS. Aquí se normaliza y listo: el DTO siempre exporta ISO o `null`.
 */
function isoDate(value: Date | string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function listChatProspects(
  filter: ProspectFilter
): Promise<ProspectDto[]> {
  const db = getDb();
  const q = filter.q?.trim() ?? "";

  // Descartados: con «Ver archivados» marcado se muestran (la tarjeta dice
  // «descartado» y ofrece Restaurar); sin marcar, se excluyen.
  const dismissed = await listDismissals(filter.organizationId, "contact");

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
        filter.archived ? undefined : isNull(schema.contact.archivedAt),
        // Lista vacía ⇒ sin condición: `not in ()` no es SQL válido.
        !filter.archived && dismissed.size > 0
          ? notInArray(schema.contact.id, [...dismissed.keys()])
          : undefined
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
      descNullsLast(schema.lead.lastActivityAt),
      desc(schema.lead.createdAt)
    )) as unknown as LeadRow[];

  const leadByContact = new Map<string, LeadRow>();
  for (const row of leadRows) {
    // Ordenado de la más preferida a la menos: la primera que se ve es la buena.
    if (!leadByContact.has(row.contactId)) leadByContact.set(row.contactId, row);
  }

  return rows.map((row) =>
    serializeProspect(row, leadByContact.get(row.contactId) ?? null, dismissed.get(row.contactId))
  );
}

/**
 * Prospectos que solo existen como remitentes de correo.
 *
 * Se consulta DESPUÉS de las oportunidades del chat para que el orden de
 * consultas del módulo no cambie, y se salta cuando el filtro pedido no puede
 * describir a un remitente: sin contacto no hay teléfono ni etapa. El «Ver
 * archivados» sí la recorre, porque ahí es donde se muestran los correos
 * descartados para poder restaurarlos.
 */
async function listEmailProspects(
  filter: ProspectFilter
): Promise<ProspectDto[]> {
  if (filter.channel && filter.channel !== EMAIL_CHANNEL) return [];
  if (filter.phone === "tiene") return [];

  const db = getDb();
  const dismissed = await listDismissals(filter.organizationId, "email");
  // El correo no tiene nombre de perfil guardado: lo único buscable es la
  // dirección, y se escapa igual que en el chat para que un "%" no la liste
  // todas.
  const q = filter.q?.trim() ?? "";
  const qLike = q ? `%${q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%` : undefined;

  const rows = (await db
    .select({
      email: schema.emailMessage.from,
      firstInboundAt: sql<Date>`MIN(${schema.emailMessage.createdAt})`,
      lastInboundAt: sql<Date>`MAX(${schema.emailMessage.createdAt})`,
      inboundCount: sql<number>`count(*)::int`,
      // El asunto, no el cuerpo: es lo que dice de qué habló esta persona sin
      // arrastrar aquí el texto completo de cada hilo.
      lastSubject: sql<string | null>`(array_agg(${schema.emailMessage.subject}
        ORDER BY ${schema.emailMessage.createdAt} DESC, ${schema.emailMessage.id} DESC))[1]`,
    })
    .from(schema.emailMessage)
    .where(
      scoped(
        schema.emailMessage.organizationId,
        filter.organizationId,
        eq(schema.emailMessage.direction, "inbound"),
        // Se compara contra `lower(...)` porque la clave guardada está
        // normalizada y `from_email` llega con las mayúsculas del servidor.
        !filter.archived && dismissed.size > 0
          ? notInArray(
              sql`lower(${schema.emailMessage.from})`,
              [...dismissed.keys()]
            )
          : undefined,
        qLike
          ? sql`lower(${schema.emailMessage.from}) like ${qLike}`
          : undefined
      )
    )
    .groupBy(schema.emailMessage.from)
    .orderBy(desc(sql`MAX(${schema.emailMessage.createdAt})`))
    .limit(LIMIT)) as unknown as EmailProspectRow[];

  return rows.map((row) =>
    serializeEmailProspect(row, dismissed.get(emailKey(row.email)))
  );
}

/**
 * La lista de la pantalla: chat y correo, del último mensaje entrante hacia
 * atrás, con el mismo corte de 200 que la consulta de chat.
 *
 * Una persona que escribió por los dos canales aparece dos veces, una por
 * canal: no hay forma de saber que es la misma (el contacto no guarda correo),
 * y fundirlas en silencio borraría de la pantalla un hilo real.
 */
export async function listProspects(
  filter: ProspectFilter
): Promise<ProspectDto[]> {
  const chat = await listChatProspects(filter);
  const email = await listEmailProspects(filter);
  if (email.length === 0) return chat;
  return [...chat, ...email]
    .sort((a, b) => (b.lastInboundAt ?? "").localeCompare(a.lastInboundAt ?? ""))
    .slice(0, LIMIT);
}

export function serializeEmailProspect(
  row: EmailProspectRow,
  dismissedAt?: string | null
): ProspectDto {
  return {
    // Sin ficha: el dueño ve quién escribió, y decide si lo da de alta.
    contactId: null,
    name: row.email,
    phone: null,
    channel: EMAIL_CHANNEL,
    channelLabel: EMAIL_CHANNEL_LABEL,
    conversationId: null,
    email: row.email,
    firstInboundAt: isoDate(row.firstInboundAt),
    lastInboundAt: isoDate(row.lastInboundAt),
    inboundCount: row.inboundCount,
    lastInboundText: row.lastSubject,
    // Un remitente de correo nunca estuvo «archivado»: no tiene contacto. Lo que
    // puede tener es un descarte, y esa es la fecha que se muestra.
    archivedAt: null,
    dismissedAt: dismissedAt ?? null,
    stageName: null,
    priority: null,
    amountCents: null,
  };
}

export function serializeProspect(
  row: ProspectRow,
  lead?: LeadRow | null,
  dismissedAt?: string | null
): ProspectDto {
  return {
    contactId: row.contactId,
    name: row.name,
    phone: row.phone,
    channel: row.channel,
    channelLabel: CHANNEL_LABEL[row.channel as Channel] ?? row.channel,
    conversationId: row.conversationId,
    email: null,
    firstInboundAt: isoDate(row.firstInboundAt),
    lastInboundAt: isoDate(row.lastInboundAt),
    inboundCount: row.inboundCount,
    lastInboundText: row.lastInboundText,
    archivedAt: isoDate(row.archivedAt),
    dismissedAt: dismissedAt ?? null,
    stageName: lead?.stageName ?? null,
    priority: (lead?.priority as ProspectDto["priority"]) ?? null,
    amountCents: lead?.amountCents ?? null,
  };
}
