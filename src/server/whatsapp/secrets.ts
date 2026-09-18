import { getDb } from "@/lib/db";
import { sql } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

export async function integrationSecret(organizationId: string, provider: string): Promise<string | null> {
  const rows = await getDb().execute(sql`SELECT cipher, iv, tag FROM integration_secret WHERE organization_id=${organizationId} AND provider=${provider}`);
  const row = rows[0];
  return row ? decryptSecret({ cipher: String(row.cipher), iv: String(row.iv), tag: String(row.tag) }) : null;
}
export async function saveIntegrationSecret(organizationId: string, provider: string, value: string) {
  const secret = encryptSecret(value);
  await getDb().execute(sql`INSERT INTO integration_secret (organization_id, provider, cipher, iv, tag)
    VALUES (${organizationId}, ${provider}, ${secret.cipher}, ${secret.iv}, ${secret.tag})
    ON CONFLICT (organization_id, provider) DO UPDATE SET cipher=excluded.cipher, iv=excluded.iv, tag=excluded.tag`);
}
