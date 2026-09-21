import { z } from "zod";

export const wahaSettingsSchema = z.object({
  deviceName: z.string().trim().max(80),
  browserName: z.enum(["Chrome", "Firefox", "Safari", "Edge", "Opera"]),
  ignoreStatus: z.boolean(), ignoreGroups: z.boolean(), ignoreChannels: z.boolean(), ignoreBroadcast: z.boolean(),
  nowebStore: z.boolean(), nowebFullSync: z.boolean(), webjsTagsEvents: z.boolean(),
  retryPolicy: z.enum(["constant", "linear", "exponential"]),
  retryDelaySeconds: z.number().int().min(1).max(300), retryAttempts: z.number().int().min(1).max(20),
  proxyServer: z.string().trim().max(255).refine((v) => !v || /^[a-zA-Z0-9.\[\]:_-]+:\d{1,5}$/.test(v), "Usa host:puerto, sin protocolo ni credenciales"),
  proxyUsername: z.string().trim().max(100), proxyPassword: z.string().max(1024).optional(),
});
export type WahaSettings = z.infer<typeof wahaSettingsSchema>;
export const DEFAULT_WAHA_SETTINGS: WahaSettings = { deviceName: "CRM", browserName: "Chrome", ignoreStatus: true, ignoreGroups: true, ignoreChannels: true, ignoreBroadcast: true, nowebStore: false, nowebFullSync: false, webjsTagsEvents: false, retryPolicy: "exponential", retryDelaySeconds: 2, retryAttempts: 8, proxyServer: "", proxyUsername: "", proxyPassword: "" };

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
/** Whitelist only: remote config includes HMAC keys, proxy passwords and custom headers. */
export function publicWahaSettings(config: Record<string, unknown>, webhookUrl: string) {
  const client = object(config.client), ignore = object(config.ignore), store = object(object(config.noweb).store), proxy = object(config.proxy);
  const hook = Array.isArray(config.webhooks) ? config.webhooks.map(object).find((h) => h.url === webhookUrl) : undefined;
  const retries = object(hook?.retries);
  return {
    ...DEFAULT_WAHA_SETTINGS,
    deviceName: typeof client.deviceName === "string" ? client.deviceName : "CRM",
    browserName: ["Chrome", "Firefox", "Safari", "Edge", "Opera"].includes(String(client.browserName)) ? client.browserName as WahaSettings["browserName"] : "Chrome",
    ignoreStatus: ignore.status === true, ignoreGroups: ignore.groups === true, ignoreChannels: ignore.channels === true, ignoreBroadcast: ignore.broadcast === true,
    nowebStore: store.enabled === true, nowebFullSync: store.fullSync === true, webjsTagsEvents: object(config.webjs).tagsEventsOn === true,
    retryPolicy: ["constant", "linear", "exponential"].includes(String(retries.policy)) ? retries.policy as WahaSettings["retryPolicy"] : "exponential" as const,
    retryDelaySeconds: typeof retries.delaySeconds === "number" ? retries.delaySeconds : 2,
    retryAttempts: typeof retries.attempts === "number" ? retries.attempts : 8,
    proxyServer: typeof proxy.server === "string" ? proxy.server : "",
    proxyUsername: typeof proxy.username === "string" ? proxy.username : "",
    hasProxyPassword: Boolean(proxy.password), proxyPassword: "",
  };
}
export function mergeWahaSettings(config: Record<string, unknown>, settings: WahaSettings) {
  const oldProxy = object(config.proxy);
  return {
    ...config,
    client: { ...object(config.client), deviceName: settings.deviceName, browserName: settings.browserName },
    ignore: { ...object(config.ignore), status: settings.ignoreStatus, groups: settings.ignoreGroups, channels: settings.ignoreChannels, broadcast: settings.ignoreBroadcast },
    noweb: { ...object(config.noweb), store: { ...object(object(config.noweb).store), enabled: settings.nowebStore, fullSync: settings.nowebFullSync } },
    webjs: { ...object(config.webjs), tagsEventsOn: settings.webjsTagsEvents },
    proxy: settings.proxyServer ? { server: settings.proxyServer, username: settings.proxyUsername, password: settings.proxyPassword || (oldProxy.server === settings.proxyServer && oldProxy.username === settings.proxyUsername ? oldProxy.password : "") || "" } : null,
  };
}
