import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { getEnv } from "@/lib/env";

export const zernioWhatsappEnabled = () => process.env.WHATSAPP_ZERNIO_ENABLED === "true";
export type WhatsappZernioCredentials = { organizationId: string; accountId: string; token: string; webhookSecret: string; displayPhone: string };
function decode(row: typeof schema.whatsappZernio.$inferSelect): WhatsappZernioCredentials {
  return { ...JSON.parse(decryptSecret(row)), organizationId: row.organizationId, accountId: row.accountId };
}
export async function getWhatsappZernio(organizationId: string) {
  const [row] = await getDb().select().from(schema.whatsappZernio).where(scoped(schema.whatsappZernio.organizationId, organizationId)).limit(1);
  return row ? decode(row) : null;
}
// Webhook bootstrap: resolve tenant from the uniquely registered remote account, then verify its signature.
export async function getWhatsappZernioByAccount(accountId: string) {
  const [row] = await getDb().select().from(schema.whatsappZernio).where(eq(schema.whatsappZernio.accountId, accountId)).limit(1);
  return row ? decode(row) : null;
}
export async function saveWhatsappZernio(input: WhatsappZernioCredentials) {
  const { organizationId, accountId, ...secrets } = input;
  const encrypted = encryptSecret(JSON.stringify(secrets));
  await getDb().insert(schema.whatsappZernio).values({ organizationId, accountId, ...encrypted })
    .onConflictDoUpdate({ target: schema.whatsappZernio.organizationId, set: { accountId, ...encrypted, updatedAt: new Date() } });
}
export function zernioWhatsappWebhookUrl(organizationId: string) {
  const token = createHmac("sha256", getEnv().META_WEBHOOK_VERIFY_TOKEN).update(`zernio-wa:${organizationId}`).digest("hex");
  return `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/api/webhooks/zernio-whatsapp/${token}`;
}
