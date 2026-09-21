import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  DEFAULT_BUSINESS_SETTINGS,
  normalizeBusinessSettings,
  type BusinessSettings,
} from "@/lib/business-settings";

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function getBusinessSettings(
  organizationId: string
): Promise<BusinessSettings> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!rows[0]) return DEFAULT_BUSINESS_SETTINGS;
  const meta = parseMetadata(rows[0].metadata);
  return normalizeBusinessSettings(
    (meta.businessSettings as Partial<BusinessSettings> | undefined) ?? null
  );
}

export async function saveBusinessSettings(
  organizationId: string,
  settings: BusinessSettings
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  meta.businessSettings = normalizeBusinessSettings(settings);
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
}
