import { createHmac } from "node:crypto";
import { getEnv } from "@/lib/env";
export function wahaWebhookToken(organizationId: string) {
  return createHmac("sha256", getEnv().META_WEBHOOK_VERIFY_TOKEN).update(`waha:${organizationId}`).digest("hex");
}
export function wahaWebhookUrl(organizationId: string) {
  return `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/api/webhooks/waha/${wahaWebhookToken(organizationId)}`;
}
