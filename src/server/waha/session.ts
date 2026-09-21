import { randomBytes } from "node:crypto";
import { integrationSecret, saveIntegrationSecret } from "@/server/whatsapp/secrets";
import { wahaWebhookUrl } from "./webhook-token";
import { wahaRequest, WahaError } from "./client";
import { mergeWahaSettings, type WahaSettings } from "@/lib/waha-settings";

type Credentials = { baseUrl: string; apiKey: string; sessionName: string };
export type SessionInfo = { name: string; status: string; config?: Record<string, unknown>; me?: { id?: string; pushName?: string; reachoutTimelock?: unknown; messageCapping?: unknown }; engine?: { engine?: string } };
export async function inspectSession(creds: Credentials): Promise<SessionInfo> {
  const data = await wahaRequest(creds.baseUrl, creds.apiKey, `/api/sessions/${encodeURIComponent(creds.sessionName)}`) as SessionInfo;
  if (!data || typeof data.status !== "string") throw new WahaError("La URL no devolvió una sesión WAHA válida");
  return data;
}

/** PUT replaces config; merge only our callback and preserve all other settings/webhooks. */
export async function reconcileSession(organizationId: string, creds: Credentials, settings?: WahaSettings) {
  let current: SessionInfo | null;
  try { current = await inspectSession(creds); }
  catch (err) { if (!(err instanceof WahaError) || err.status !== 404) throw err; current = null; }
  let key = await integrationSecret(organizationId, "waha");
  if (!key) { key = randomBytes(32).toString("hex"); await saveIntegrationSecret(organizationId, "waha", key); }
  const url = wahaWebhookUrl(organizationId);
  const config: Record<string, unknown> = settings ? mergeWahaSettings(current?.config ?? {}, settings) : current?.config ?? {};
  const hooks = Array.isArray(config.webhooks) ? config.webhooks as { url?: string }[] : [];
  const previous = hooks.find((item) => item.url === url);
  const oldRetries = (previous as { retries?: unknown } | undefined)?.retries;
  const hook = { url, events: ["message.any", "message.ack", "session.status"], hmac: { key }, retries: settings ? { policy: settings.retryPolicy, delaySeconds: settings.retryDelaySeconds, attempts: settings.retryAttempts } : oldRetries ?? { policy: "exponential", delaySeconds: 2, attempts: 8 } };
  if (!settings && current && JSON.stringify(previous) === JSON.stringify(hook)) return;
  const merged = { ...config, webhooks: [...hooks.filter((item) => item.url !== url), hook] };
  await wahaRequest(creds.baseUrl, creds.apiKey, current ? `/api/sessions/${encodeURIComponent(creds.sessionName)}` : "/api/sessions", {
    method: current ? "PUT" : "POST", body: { name: creds.sessionName, ...(current ? {} : { start: false }), config: merged },
  });
}
