import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * Descartar un prospecto: «esta persona ya no me interesa en la lista».
 *
 * Es una marca, no un borrado. Prospectos es una vista sobre los mensajes
 * entrantes, así que «borrar la fila» habría significado borrar conversaciones
 * reales de cliente (`contact` + `message`) o, en el correo, nada en absoluto
 * porque el remitente ni siquiera tiene ficha. Aquí se anota la clave y la
 * consulta la excluye; el historial sigue intacto y se puede revertir.
 *
 * La clave es el `contact.id` o la dirección de correo **en minúsculas**: el
 * correo se compara con `lower(from_email)` en la consulta, y los servidores de
 * correo no garantizan el mismo mayúsculas/minúsculas en un mismo buzón.
 */

export type ProspectKind = "contact" | "email";

export type ProspectTarget = { kind: ProspectKind; key: string };

/** La dirección normalizada con la que se guarda y se busca un descarte. */
export function emailKey(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * De los dos campos de la petición a la clave a marcar.
 *
 * Devuelve `null` (y la ruta responde 422) si llegan los dos, ninguno, o el
 * correo no tiene forma de dirección: una tabla de descartes con claves
 * ambiguas no se puede consultar sin arriesgarse a ocultar a otro.
 */
export function prospectTargetOf(input: {
  contactId?: string | null;
  email?: string | null;
}): ProspectTarget | null {
  const contactId = input.contactId?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  if (contactId && email) return null;
  // Se rechaza el `id` desbordado en lugar de recortarlo: una clave truncada se
  // guardaría sin coincidencia posible y el descarte quedaría inrestaurable.
  if (contactId) return contactId.length > 255 ? null : { kind: "contact", key: contactId };
  if (!email) return null;
  const key = emailKey(email);
  if (!key.includes("@") || key.length > 255) return null;
  return { kind: "email", key };
}

export async function dismissProspect(
  organizationId: string,
  userId: string,
  target: ProspectTarget
): Promise<void> {
  const db = getDb();
  // `onConflictDoNothing`: descartar dos veces no borra la marca y no pisa
  // cuándo ni quién la puso. El índice único es (org, kind, key).
  await db
    .insert(schema.prospectDismissal)
    .values({
      id: newId("prospectDismissal"),
      organizationId,
      kind: target.kind,
      key: target.key,
      dismissedBy: userId || null,
    })
    .onConflictDoNothing({
      target: [
        schema.prospectDismissal.organizationId,
        schema.prospectDismissal.kind,
        schema.prospectDismissal.key,
      ],
    });
}

export async function restoreProspect(
  organizationId: string,
  target: ProspectTarget
): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.prospectDismissal)
    .where(
      scoped(
        schema.prospectDismissal.organizationId,
        organizationId,
        eq(schema.prospectDismissal.kind, target.kind),
        eq(schema.prospectDismissal.key, target.key)
      )
    );
}

/**
 * Claves descartadas de un tipo, con su fecha.
 *
 * Se lee de una y se resuelve en memoria en vez de unir la tabla en cada
 * consulta de la lista: la vista de prospectos agrupa mensajes, y un join más
 * sobre un `GROUP BY` sale caro para algo que a lo sumo son unos cientos de
 * claves.
 */
export async function listDismissals(
  organizationId: string,
  kind: ProspectKind
): Promise<Map<string, string>> {
  const db = getDb();
  const rows = await db
    .select({
      key: schema.prospectDismissal.key,
      createdAt: schema.prospectDismissal.createdAt,
    })
    .from(schema.prospectDismissal)
    .where(
      scoped(
        schema.prospectDismissal.organizationId,
        organizationId,
        eq(schema.prospectDismissal.kind, kind)
      )
    );
  const out = new Map<string, string>();
  for (const row of rows) {
    const at = row.createdAt instanceof Date ? row.createdAt.toISOString() : null;
    out.set(row.key, at ?? String(row.createdAt ?? ""));
  }
  return out;
}
