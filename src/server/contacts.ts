import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { isMediumValue, isSocialNetwork, normalizeMedium } from "@/lib/contact-medium";
import { normalizeMx } from "@/lib/meta/client";
import { createLeadForContact } from "@/server/inbox/lead-activity";
import { publishWebhook } from "@/server/webhooks/dispatcher";
import { upsertFicha } from "@/server/bot/ficha";
import { effectiveSource } from "@/server/contact-source";
import type { FichaDto, PriorityValue } from "@/lib/types";

export function serializeContact(
  c: typeof schema.contact.$inferSelect,
  stageName: string | null = null,
  priority: PriorityValue | null = null,
  amountCents: number | null = null
) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    notes: c.notes,
    channel: c.channel,
    stageName,
    amountCents,
    archivedAt: c.archivedAt?.toISOString() ?? null,
    source: effectiveSource(c.source),
    purchaseProduct: c.purchaseProduct,
    purchaseDate: c.purchaseDate?.toISOString() ?? null,
    purchaseAmountCents: c.purchaseAmountCents,
    // Nace NULL como `source`: nadie captura a mano el medio de los cientos de
    // contactos ya existentes, y un valor inventado en el listado sería peor
    // que "sin capturar".
    medium: isMediumValue(c.medium) ? c.medium : null,
    mediumDetail:
      c.medium === "red_social" && isSocialNetwork(c.mediumDetail)
        ? c.mediumDetail
        : null,
    priority,
    // Viaja siempre, aunque esté vacía: la pantalla necesita distinguir "aún
    // no la han llenado" de "este contacto no la trae".
    ficha: (c.ficha as FichaDto | null) ?? {},
  };
}

export async function getContactById(
  organizationId: string,
  contactId: string
) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, contactId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Etapa actual del lead del contacto (si existe). */
export async function getContactStage(
  organizationId: string,
  contactId: string
) {
  const db = getDb();
  const rows = await db
    .select({ stage: schema.pipelineStage, lead: schema.lead })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      eq(schema.lead.stageId, schema.pipelineStage.id)
    )
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    // Multi-oportunidad: el contacto puede tener varias. Las rutas 1:1 (UI,
    // bot, agenda) operan sobre la principal y, de igual, la más activa.
    .orderBy(desc(schema.lead.isPrimary), desc(schema.lead.lastActivityAt))
    .limit(1);
  return rows[0] ?? null;
}

/* ============================================================
 * Escrituras de contactos — única fuente de verdad, compartida
 * por la API interna del CRM y por el MCP. Toda alta crea lead,
 * publica webhook y normaliza identidad igual que la UI: nada de
 * registros huérfanos cuando se captura desde ChatGPT.
 * ============================================================ */

export type ContactSourceValue =
  | "anuncio"
  | "organico"
  | "referido"
  | "conocido"
  | "compra"
  | "otro";

export type CreateContactInput = {
  organizationId: string;
  actorUserId: string;
  name: string;
  phone: string;
  notes?: string;
  source?: ContactSourceValue;
  medium?: unknown;
  mediumDetail?: unknown;
  stageId?: string;
};

export type CreateContactResult =
  | {
      ok: true;
      contact: ReturnType<typeof serializeContact>;
      lead: { id: string };
    }
  | { ok: false; code: "medium" | "duplicate" | "no_stage"; message: string };

export async function createContact(
  input: CreateContactInput
): Promise<CreateContactResult> {
  const medium = normalizeMedium({
    medium: input.medium ?? null,
    mediumDetail: input.mediumDetail ?? null,
  });
  if (!medium.ok) {
    return { ok: false, code: "medium", message: medium.error };
  }

  const db = getDb();
  // 003: la identidad WhatsApp se deriva del teléfono normalizado.
  const phone = normalizeMx(input.phone);
  const contactId = newId("contact");
  await db
    .insert(schema.contact)
    .values({
      id: contactId,
      organizationId: input.organizationId,
      name: input.name,
      phone,
      waIdentity: phone,
      notes: input.notes ?? null,
      source: input.source ?? null,
      medium: medium.medium,
      mediumDetail: medium.mediumDetail,
    })
    // El canal entra en el target porque entra en el índice único desde 014
    // (`contact_org_channel_identity_uq`). Postgres exige que el ON CONFLICT
    // nombre EXACTAMENTE las columnas de un índice existente: sin `channel`,
    // el alta manual falla con "no unique or exclusion constraint matching".
    .onConflictDoNothing({
      target: [
        schema.contact.organizationId,
        schema.contact.channel,
        schema.contact.waIdentity,
      ],
    });
  const [existingContact] = await db
    .select()
    .from(schema.contact)
    .where(eq(schema.contact.id, contactId))
    .limit(1);
  if (!existingContact) {
    return {
      ok: false,
      code: "duplicate",
      message: "Ya existe un contacto con ese teléfono",
    };
  }

  if (input.notes?.trim()) {
    await db.insert(schema.contactNote).values({
      id: newId("contactNote"),
      organizationId: input.organizationId,
      contactId: existingContact.id,
      body: input.notes,
      source: "manual",
      createdBy: input.actorUserId,
    });
  }

  // Y su lead: un contacto sin lead es invisible en el Pipeline.
  const lead = await createLeadForContact({
    organizationId: input.organizationId,
    contactId: existingContact.id,
    stageId: input.stageId,
    source: "dueno",
    actorUserId: input.actorUserId,
  });
  if (!lead) {
    return {
      ok: false,
      code: "no_stage",
      message:
        "El tablero no tiene etapas abiertas donde colocar al prospecto",
    };
  }

  publishWebhook(input.organizationId, "contact.created", {
    contact: {
      id: existingContact.id,
      name: existingContact.name,
      phone: existingContact.phone,
    },
    lead: { id: lead.id },
  });

  return {
    ok: true,
    contact: serializeContact(existingContact),
    lead: { id: lead.id },
  };
}

export type UpdateContactInput = {
  organizationId: string;
  actorUserId: string;
  contactId: string;
  name?: string;
  phone?: string | null;
  notes?: string | null;
  archived?: boolean;
  ficha?: Record<string, unknown>;
  medium?: unknown;
  mediumDetail?: unknown;
  source?: ContactSourceValue | null;
  purchaseProduct?: string | null;
  purchaseDate?: string | null;
  purchaseAmountCents?: number | null;
};

export type UpdateContactResult =
  | { ok: true; contact: ReturnType<typeof serializeContact> }
  | { ok: false; code: "not_found" | "medium"; message: string };

export async function updateContact(
  input: UpdateContactInput
): Promise<UpdateContactResult> {
  const current = await getContactById(input.organizationId, input.contactId);
  if (!current) {
    return { ok: false, code: "not_found", message: "Contacto no encontrado" };
  }

  if (input.ficha !== undefined) {
    const res = await upsertFicha({
      organizationId: input.organizationId,
      contactId: input.contactId,
      ficha: input.ficha,
    });
    if (!res) {
      return { ok: false, code: "not_found", message: "Contacto no encontrado" };
    }
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };

  const mediumTocado =
    input.medium !== undefined || input.mediumDetail !== undefined;
  if (mediumTocado) {
    const medium = normalizeMedium({
      medium: input.medium ?? null,
      mediumDetail: input.mediumDetail ?? null,
    });
    if (!medium.ok) {
      return { ok: false, code: "medium", message: medium.error };
    }
    set.medium = medium.medium;
    set.mediumDetail = medium.mediumDetail;
  }
  if (input.name !== undefined) {
    set.name = input.name;
    set.nameSource = "manual";
  }
  if (input.phone !== undefined) {
    // Normaliza al formato canónico (solo dígitos + 521→52): es el mismo
    // formato con el que la ingesta guarda `phone`/`wa_identity`.
    const phone = input.phone ? normalizeMx(input.phone.replace(/\D/g, "")) : null;
    set.phone = phone;
    if (phone && current.channel === "whatsapp" && !current.waIdentity.includes(":")) {
      set.waIdentity = phone;
    }
  }
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.archived !== undefined) {
    set.archivedAt = input.archived ? new Date() : null;
  }
  if (input.source !== undefined) set.source = input.source;
  // El detalle de compra solo aplica a la fuente "Compra": cambiar la fuente a
  // otro valor borra el rastro para que la ficha no muestre una compra que ya
  // no es la fuente de este contacto.
  const fuenteEsCompra =
    input.source !== undefined
      ? input.source === "compra"
      : current.source === "compra";
  if (fuenteEsCompra) {
    if (input.purchaseProduct !== undefined) set.purchaseProduct = input.purchaseProduct;
    if (input.purchaseDate !== undefined) {
      set.purchaseDate = input.purchaseDate ? new Date(input.purchaseDate) : null;
    }
    if (input.purchaseAmountCents !== undefined) {
      set.purchaseAmountCents = input.purchaseAmountCents;
    }
  } else if (input.source !== undefined) {
    set.purchaseProduct = null;
    set.purchaseDate = null;
    set.purchaseAmountCents = null;
  }

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.contact)
      .set(set)
      .where(
        scoped(
          schema.contact.organizationId,
          input.organizationId,
          eq(schema.contact.id, input.contactId)
        )
      );
    if (input.notes !== undefined && input.notes !== current.notes) {
      await tx.insert(schema.contactNote).values({
        id: newId("contactNote"),
        organizationId: input.organizationId,
        contactId: input.contactId,
        body: input.notes ?? "",
        source: "manual",
        createdBy: input.actorUserId,
      });
    }
  });
  const contact = await getContactById(input.organizationId, input.contactId);
  if (!contact) {
    return { ok: false, code: "not_found", message: "Contacto no encontrado" };
  }
  return { ok: true, contact: serializeContact(contact) };
}

export type DeleteContactResult =
  | { ok: true; deleted: true }
  | { ok: false; code: "not_found"; message: string };

export async function deleteContact(
  organizationId: string,
  contactId: string
): Promise<DeleteContactResult> {
  const contact = await getContactById(organizationId, contactId);
  if (!contact) {
    return { ok: false, code: "not_found", message: "Contacto no encontrado" };
  }

  const db = getDb();
  await db
    .delete(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, contactId)
      )
    );

  return { ok: true, deleted: true };
}

export type AddContactNoteInput = {
  organizationId: string;
  actorUserId: string;
  contactId: string;
  body: string;
};

export type AddContactNoteResult =
  | { ok: true; noteId: string }
  | { ok: false; code: "not_found"; message: string };

export async function addContactNote(
  input: AddContactNoteInput
): Promise<AddContactNoteResult> {
  const contact = await getContactById(input.organizationId, input.contactId);
  if (!contact) {
    return { ok: false, code: "not_found", message: "Contacto no encontrado" };
  }

  const noteId = newId("contactNote");
  await getDb()
    .insert(schema.contactNote)
    .values({
      id: noteId,
      organizationId: input.organizationId,
      contactId: input.contactId,
      body: input.body,
      source: "manual",
      createdBy: input.actorUserId,
    });

  return { ok: true, noteId };
}
