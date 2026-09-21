import { describe, expect, it } from "vitest";
import { DEFAULT_WAHA_SETTINGS, mergeWahaSettings, publicWahaSettings, wahaSettingsSchema } from "@/lib/waha-settings";
describe("WAHA configuración", () => {
  const config = { proxy: { server: "proxy:3128", username: "user", password: "private-password" }, webhooks: [{ url: "https://crm/hook", hmac: { key: "private-key" }, customHeaders: [{ value: "private-token" }] }], metadata: { custom: true }, noweb: { custom: 1, store: { custom: 2 } } };
  it("no expone secretos remotos al navegador", () => {
    const publicConfig = publicWahaSettings(config, "https://crm/hook");
    expect(JSON.stringify(publicConfig)).not.toContain("private-");
    expect(publicConfig.hasProxyPassword).toBe(true);
  });
  it("conserva configuración ajena y contraseña del mismo proxy", () => {
    const result = mergeWahaSettings(config, { ...DEFAULT_WAHA_SETTINGS, proxyServer: "proxy:3128", proxyUsername: "user" });
    expect(result.proxy?.password).toBe("private-password");
    expect(result.noweb).toMatchObject({ custom: 1, store: { custom: 2 } });
    expect(result).toMatchObject({ webhooks: config.webhooks, metadata: config.metadata });
  });
  it("no envía la contraseña previa a un proxy diferente y permite desactivar proxy", () => {
    expect(mergeWahaSettings(config, { ...DEFAULT_WAHA_SETTINGS, proxyServer: "other:3128", proxyUsername: "user" }).proxy?.password).toBe("");
    expect(mergeWahaSettings(config, DEFAULT_WAHA_SETTINGS).proxy).toBeNull();
  });
  it("rechaza reintentos sin límite y credenciales embebidas en host", () => {
    expect(wahaSettingsSchema.safeParse({ ...DEFAULT_WAHA_SETTINGS, retryAttempts: 9999 }).success).toBe(false);
    expect(wahaSettingsSchema.safeParse({ ...DEFAULT_WAHA_SETTINGS, proxyServer: "user:pass@host:80" }).success).toBe(false);
  });
});
