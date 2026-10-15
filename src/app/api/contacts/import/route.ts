import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { normalizeMx } from "@/lib/meta/client";
import { parseCsv } from "@/lib/csv";
import { createLeadForContact } from "@/server/inbox/lead-activity";
import { publishWebhook } from "@/server/webhooks/dispatcher";

export const dynamic = "force-dynamic";

const importSchema = z.object({
  csv: z.string().min(1, "CSV vacío").max(2_000_000, "Archivo demasiado grande (máx 2 MB)"),
});

const VALID_SOURCES = new Set([
  "anuncio",
  "organico",
  "referido",
  "conocido",
  "compra",
  "otro",
]);

/** Mapea headers comunes del CSV a campos internos. */
function mapRow(row: Record<string, string>): { name: string; phone: string; notes?: string; source?: string; stage?: string } | null {
  const name = row["nombre"] || row["name"] || row["nombre_completo"] || row["full_name"] || "";
  const phone =
    row["telefono"] || row["teléfono"] || row["phone"] || row["whatsapp"] || row["numero"] || row["número"] || "";
  const notes = row["notas"] || row["notes"] || row["observaciones"] || "";
  const source = row["fuente"] || row["source"] || "";
  const stage = row["etapa"] || row["stage"] || "";
  if (!name.trim() || !phone.trim()) return null;
  return {
    name: name.trim().slice(0, 120),
    phone: phone.replace(/[\s\-()+.]/g, ""),
    notes: notes.trim().slice(0, 4000) || undefined,
    source: source.trim() || undefined,
    stage: stage.trim() || undefined,
  };
}

export const POST = withAuth(async (session, req: Request) => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiError(422, "invalid_body", "El body debe ser JSON válido");
  }
  const parsed = importSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError(422, "invalid_body", parsed.error.issues[0]?.message ?? "Body inválido");
  }

  const rows = parseCsv(parsed.data.csv);
  if (rows.length === 0) {
    return apiError(422, "empty_csv", "El archivo no tiene filas de datos");
  }
  if (rows.length > 2000) {
    return apiError(422, "too_many_rows", "Máximo 2000 contactos por importación");
  }

  const db = getDb();

  // Resolver etapas por nombre → id
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, session.organizationId));
  const stageByName = new Map(stages.map((s) => [s.name.toLowerCase(), s.id]));

  let imported = 0;
  let skipped = 0;
  const errors: { row: number; message: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) { skipped++; continue; }
    const mapped = mapRow(row);
    if (!mapped) {
      skipped++;
      errors.push({ row: i + 2, message: "Falta nombre o teléfono" });
      continue;
    }
    if (!/^\d{7,15}$/.test(mapped.phone)) {
      skipped++;
      errors.push({ row: i + 2, message: `Teléfono inválido: ${mapped.phone}` });
      continue;
    }

    const phone = normalizeMx(mapped.phone);
    const contactId = newId("contact");

    try {
      await db
        .insert(schema.contact)
        .values({
          id: contactId,
          organizationId: session.organizationId,
          name: mapped.name,
          phone,
          waIdentity: phone,
          notes: mapped.notes ?? null,
          source: VALID_SOURCES.has(mapped.source ?? "") ? mapped.source : null,
        })
        .onConflictDoNothing({
          target: [schema.contact.organizationId, schema.contact.channel, schema.contact.waIdentity],
        });

      // onConflictDoNothing no avisa: re-select por id para saber si es nuevo
      const [existing] = await db
        .select()
        .from(schema.contact)
        .where(eq(schema.contact.id, contactId))
        .limit(1);

      if (!existing) {
        skipped++; // duplicado
        continue;
      }

      // Lead para que el contacto sea visible en Pipeline
      const stageId = mapped.stage ? (stageByName.get(mapped.stage.toLowerCase()) ?? undefined) : undefined;
      await createLeadForContact({
        organizationId: session.organizationId,
        contactId: existing.id,
        stageId,
        source: "dueno",
        actorUserId: session.userId,
      });

      publishWebhook(session.organizationId, "contact.created", {
        contact: { id: existing.id, name: existing.name, phone: existing.phone },
      });

      imported++;
    } catch (err) {
      skipped++;
      errors.push({ row: i + 2, message: err instanceof Error ? err.message : "Error al insertar" });
    }
  }

  return Response.json({ imported, skipped, errors: errors.slice(0, 50) });
});
