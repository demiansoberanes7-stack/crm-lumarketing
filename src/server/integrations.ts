import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

export type IntegrationProvider =
  | "google_ads"
  | "meta_ads"
  | "ga4"
  /** Reglas del motor de automatizaciones (reglas editables desde la UI). */
  | "automation_rules";

export interface Integration {
  id: string;
  organizationId: string;
  provider: IntegrationProvider;
  credentials: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export async function getIntegrations(organizationId: string): Promise<Integration[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.integration)
    .where(eq(schema.integration.organizationId, organizationId));
  return rows as Integration[];
}

export async function getIntegration(
  organizationId: string,
  provider: IntegrationProvider
): Promise<Integration | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.integration)
    .where(
      and(
        eq(schema.integration.organizationId, organizationId),
        eq(schema.integration.provider, provider)
      )
    )
    .limit(1);
  return rows[0] as Integration | null;
}

export async function saveIntegration(
  organizationId: string,
  provider: IntegrationProvider,
  credentials: Record<string, unknown>
): Promise<void> {
  const db = getDb();
  const existing = await getIntegration(organizationId, provider);
  if (existing) {
    await db
      .update(schema.integration)
      .set({
        credentials,
        updatedAt: new Date(),
      })
      .where(eq(schema.integration.id, existing.id));
  } else {
    await db.insert(schema.integration).values({
      id: newId("integration"),
      organizationId,
      provider,
      credentials,
    });
  }
}

export async function deleteIntegration(
  organizationId: string,
  provider: IntegrationProvider
): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.integration)
    .where(
      and(
        eq(schema.integration.organizationId, organizationId),
        eq(schema.integration.provider, provider)
      )
    );
}
