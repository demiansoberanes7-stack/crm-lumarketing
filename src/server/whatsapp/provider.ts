import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
export async function whatsappProvider(organizationId: string): Promise<"meta" | "waha"> {
  const [org] = await getDb().select({ metadata: schema.organization.metadata }).from(schema.organization).where(eq(schema.organization.id, organizationId));
  const metadata = JSON.parse(org?.metadata || "{}");
  return metadata.whatsappProvider === "waha" ? "waha" : "meta";
}
export async function setWhatsappProvider(organizationId: string, provider: "meta" | "waha") {
  await getDb().update(schema.organization).set({ metadata: sql`(COALESCE(NULLIF(${schema.organization.metadata}, ''), '{}')::jsonb || jsonb_build_object('whatsappProvider', ${provider}::text))::text` }).where(eq(schema.organization.id, organizationId));
}
