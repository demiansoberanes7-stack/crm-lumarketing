import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { createItemSchema, updateItemSchema } from "@/lib/project-contract";
import { ProjectError } from "./errors";

/** Productos / servicios del expediente, en el orden en que se imprimen. */
export async function listItems(organizationId: string, projectId: string) {
  return getDb()
    .select()
    .from(schema.projectItem)
    .where(
      scoped(
        schema.projectItem.organizationId,
        organizationId,
        eq(schema.projectItem.projectId, projectId)
      )
    )
    .orderBy(asc(schema.projectItem.position), asc(schema.projectItem.createdAt));
}

export async function createItem(
  organizationId: string,
  projectId: string,
  input: z.infer<typeof createItemSchema>
) {
  const id = newId("projectItem");
  // `position` al final: la sección del PDF es una lista, no un catálogo con
  // orden importado.
  const [last] = await getDb()
    .select({ position: schema.projectItem.position })
    .from(schema.projectItem)
    .where(
      scoped(
        schema.projectItem.organizationId,
        organizationId,
        eq(schema.projectItem.projectId, projectId)
      )
    )
    .orderBy(asc(schema.projectItem.position))
    .limit(1);
  await getDb().insert(schema.projectItem).values({
    id,
    organizationId,
    projectId,
    name: input.name,
    description: input.description ?? null,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    position: (last?.position ?? -1) + 1,
  });
  return id;
}

export async function updateItem(
  organizationId: string,
  projectId: string,
  itemId: string,
  input: z.infer<typeof updateItemSchema>
) {
  const [item] = await getDb()
    .update(schema.projectItem)
    .set({ ...input, updatedAt: new Date() })
    .where(
      scoped(
        schema.projectItem.organizationId,
        organizationId,
        eq(schema.projectItem.projectId, projectId),
        eq(schema.projectItem.id, itemId)
      )
    )
    .returning();
  if (!item) throw new ProjectError(404, "Partida no encontrada en este proyecto");
  return item;
}

export async function deleteItem(
  organizationId: string,
  projectId: string,
  itemId: string
) {
  const deleted = await getDb()
    .delete(schema.projectItem)
    .where(
      scoped(
        schema.projectItem.organizationId,
        organizationId,
        eq(schema.projectItem.projectId, projectId),
        eq(schema.projectItem.id, itemId)
      )
    )
    .returning({ id: schema.projectItem.id });
  if (!deleted.length) throw new ProjectError(404, "Partida no encontrada en este proyecto");
}
