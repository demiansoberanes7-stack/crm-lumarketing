import { desc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { csvBlob, stringifyCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const stage = url.searchParams.get("stage")?.trim();
  // Mismo filtro que la lista: la pantalla de Contactos envía won=1 y el CSV
  // debe salir con lo que se ve, no con el directorio entero.
  const soloClientes = url.searchParams.get("won") === "1";
  const includeArchived = url.searchParams.get("archived") === "true";

  const db = getDb();

  // Etapas de cada lead (misma separación que el GET de lista)
  const leadStages = await db
    .select({
      contactId: schema.lead.contactId,
      stageName: schema.pipelineStage.name,
      stageKind: schema.pipelineStage.kind,
      priority: schema.lead.priority,
    })
    .from(schema.lead)
    .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
    .where(scoped(schema.lead.organizationId, session.organizationId));
  const stageByContact = new Map(leadStages.map((r) => [r.contactId, r.stageName]));
  const clienteContactIds = new Set(
    leadStages.filter((r) => r.stageKind === "won").map((r) => r.contactId)
  );

  const rows = await db
    .select()
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, session.organizationId))
    .orderBy(desc(schema.contact.updatedAt))
    .limit(10000); // tope alto pero no ilimitado para evitar OOM

  const contacts = rows
    .filter((c) => {
      if (!includeArchived && c.archivedAt) return false;
      if (stage && stageByContact.get(c.id) !== stage) return false;
      if (soloClientes && !clienteContactIds.has(c.id)) return false;
      if (q) {
        const ql = q.toLowerCase();
        const nameMatch = c.name.toLowerCase().includes(ql);
        const phoneMatch = c.phone?.includes(q) ?? false;
        if (!nameMatch && !phoneMatch) return false;
      }
      return true;
    })
    .map((c) => ({
      nombre: c.name,
      telefono: c.phone ?? "",
      notas: c.notes ?? "",
      etapa: stageByContact.get(c.id) ?? "",
      fuente: c.source ?? "",
      producto_compra: c.purchaseProduct ?? "",
      fecha_compra: c.purchaseDate?.toISOString().slice(0, 10) ?? "",
      monto_compra: c.purchaseAmountCents != null ? (c.purchaseAmountCents / 100).toFixed(2) : "",
      medio: c.medium ?? "",
      archivado: c.archivedAt ? "si" : "no",
      creado: c.createdAt.toISOString().slice(0, 10),
    }));

  const csv = stringifyCsv(contacts, [
    "nombre",
    "telefono",
    "notas",
    "etapa",
    "fuente",
    "producto_compra",
    "fecha_compra",
    "monto_compra",
    "medio",
    "archivado",
    "creado",
  ]);

  return new Response(csvBlob(csv), {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="contactos-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
