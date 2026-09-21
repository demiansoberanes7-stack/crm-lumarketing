import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
export async function whatsappProvider(organizationId: string): Promise<"meta" | "waha" | "zernio"> {
  const [row] = await getDb().execute(sql`SELECT provider FROM whatsapp_settings WHERE organization_id=${organizationId}`);
  return row?.provider === "zernio" ? "zernio" : row?.provider === "waha" ? "waha" : "meta";
}
export async function setWhatsappProvider(organizationId: string, provider: "meta" | "waha" | "zernio") {
  await getDb().execute(sql`INSERT INTO whatsapp_settings (organization_id, provider) VALUES (${organizationId}, ${provider})
    ON CONFLICT (organization_id) DO UPDATE SET provider=excluded.provider, updated_at=now()`);
}
