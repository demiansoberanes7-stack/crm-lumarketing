import { z } from "zod";
import {
  addContactNote,
  createContact,
  deleteContact,
  getContactById,
  getContactStage,
  serializeContact,
  updateContact,
} from "@/server/contacts";
import { defineAction } from "@/server/mcp/registry";

const sourceEnum = z.enum([
  "anuncio",
  "organico",
  "referido",
  "conocido",
  "compra",
  "otro",
]);

/** Forma cruda reutilizada por la herramienta nativa `create_contact`. */
export const contactsCreateShape = {
  name: z.string().trim().min(1).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\d{7,15}$/, "Teléfono solo dígitos con código de país (ej. 5215512345678)"),
  notes: z.string().max(4000).optional(),
  source: sourceEnum.optional(),
  medium: z.unknown().optional(),
  mediumDetail: z.unknown().optional(),
  stageId: z.string().min(1).max(255).optional(),
};

const contactsCreate = z.object(contactsCreateShape);

const contactsUpdate = z
  .object({
    contactId: z.string().min(1).max(255),
    name: z.string().trim().min(1).max(120).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\d{7,15}$/, "Teléfono solo dígitos con código de país (ej. 5215512345678)")
      .optional(),
    notes: z.string().max(4000).nullable().optional(),
    archived: z.boolean().optional(),
    medium: z.unknown().optional(),
    mediumDetail: z.unknown().optional(),
    source: sourceEnum.nullable().optional(),
    purchaseProduct: z.string().max(240).nullable().optional(),
    purchaseDate: z.string().max(40).nullable().optional(),
    purchaseAmountCents: z.number().int().min(0).nullable().optional(),
    ficha: z.record(z.unknown()).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.phone !== undefined ||
      value.notes !== undefined ||
      value.archived !== undefined ||
      value.medium !== undefined ||
      value.mediumDetail !== undefined ||
      value.source !== undefined ||
      value.purchaseProduct !== undefined ||
      value.purchaseDate !== undefined ||
      value.purchaseAmountCents !== undefined ||
      value.ficha !== undefined,
    { message: "Al menos un campo es obligatorio" }
  );

const contactsGet = z.object({
  contactId: z.string().min(1).max(255),
});

const contactsAddNote = z.object({
  contactId: z.string().min(1).max(255),
  body: z.string().trim().min(1).max(4000),
});

const contactsDelete = z.object({
  contactId: z.string().min(1).max(255),
});

export const contactsActions = [
  defineAction({
    name: "contacts.create",
    domain: "contacts",
    kind: "write",
    scope: "crm.contacts.write",
    title: "Crear contacto",
    description:
      "Captura un contacto nuevo con teléfono; crea su lead en el tablero para que aparezca en el Pipeline.",
    input: contactsCreate,
    handler: async (principal, input) => {
      const result = await createContact({
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        ...input,
      });
      if (!result.ok) throw new Error(result.message);
      return {
        text: `Contacto ${result.contact.name} creado (lead ${result.lead.id}).`,
        structuredContent: { contact: result.contact, lead: result.lead },
      };
    },
  }),

  defineAction({
    name: "contacts.update",
    domain: "contacts",
    kind: "write",
    scope: "crm.contacts.write",
    title: "Actualizar contacto",
    description:
      "Actualiza datos de un contacto (nombre, teléfono, notas, fuente, archivado, ficha y detalle de compra).",
    input: contactsUpdate,
    handler: async (principal, input) => {
      const { contactId, ...patch } = input;
      const result = await updateContact({
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        contactId,
        ...patch,
      });
      if (!result.ok) throw new Error(result.message);
      return {
        text: `Contacto ${result.contact.name} actualizado.`,
        structuredContent: { contact: result.contact },
      };
    },
  }),

  defineAction({
    name: "contacts.add_note",
    domain: "contacts",
    kind: "write",
    scope: "crm.contacts.write",
    title: "Agregar nota al contacto",
    description: "Agrega una nota al historial del contacto sin alterar sus datos.",
    input: contactsAddNote,
    handler: async (principal, input) => {
      const result = await addContactNote({
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        contactId: input.contactId,
        body: input.body,
      });
      if (!result.ok) throw new Error(result.message);
      return {
        text: `Nota agregada a ${input.contactId}.`,
        structuredContent: { contactId: input.contactId, noteId: result.noteId },
      };
    },
  }),

  defineAction({
    name: "contacts.delete",
    domain: "contacts",
    kind: "delete",
    scope: "crm.contacts.delete",
    title: "Eliminar contacto",
    description:
      "Elimina un contacto de forma permanente junto con sus relaciones. No se puede deshacer.",
    destructive: true,
    input: contactsDelete,
    handler: async (principal, input) => {
      const result = await deleteContact(principal.organizationId, input.contactId);
      if (!result.ok) throw new Error(result.message);
      return {
        text: `Contacto ${input.contactId} eliminado.`,
        structuredContent: { contactId: input.contactId, deleted: true },
      };
    },
  }),

  defineAction({
    name: "contacts.get",
    domain: "contacts",
    kind: "read",
    scope: "crm.contacts.read",
    title: "Obtener contacto",
    description: "Devuelve un contacto por ID con su etapa de pipeline actual.",
    input: contactsGet,
    handler: async (principal, input) => {
      const contact = await getContactById(principal.organizationId, input.contactId);
      if (!contact) throw new Error("Contacto no encontrado");
      const stage = await getContactStage(principal.organizationId, input.contactId);
      return {
        text: contact.name,
        structuredContent: {
          contact: serializeContact(contact),
          stage: stage
            ? { id: stage.stage.id, name: stage.stage.name }
            : null,
        },
      };
    },
  }),
];
