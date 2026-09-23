/** Local app + PostgreSQL + provider mocks; run with APP_BASE_URL pointing at the test app.
 * Requires AGENDA=on, WHATSAPP_ZERNIO_ENABLED=true, CHANNELS=whatsapp,messenger,
 * WA_MOCK_ENABLED=true and the Zernio/Google base URLs pointing at local mocks.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.APP_BASE_URL ?? "http://localhost:3310";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: base });
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(90000);

async function submit(button, path, method) {
  const response = page.waitForResponse((res) => new URL(res.url()).pathname === path && res.request().method() === method);
  await page.getByRole("button", { name: button, exact: true }).click();
  return response;
}

try {
  const credentials = { email: "settings-e2e@example.test", password: "settings-local-password", name: "Settings E2E" };
  let auth = await context.request.post("/api/auth/sign-up/email", { data: credentials, headers: { origin: base } });
  if (!auth.ok()) auth = await context.request.post("/api/auth/sign-in/email", { data: credentials, headers: { origin: base } });
  assert(auth.ok(), "Login del propietario");

  await page.goto("/settings");
  await page.getByRole("heading", { name: "WhatsApp mediante Zernio" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Meta Business", exact: true }).count(), 0);
  await page.getByRole("link", { name: "WhatsApp · Zernio", exact: true }).waitFor();
  await page.getByLabel("Account ID de WhatsApp").fill("wa-settings-e2e");
  await page.getByLabel("API key de Zernio").fill("key-invalid");
  await page.getByLabel("Secreto de firma del webhook").fill("settings-webhook-secret");
  assert.equal((await submit("Guardar conexión Zernio", "/api/settings/whatsapp/zernio", "PUT")).status(), 422);
  assert.equal((await (await context.request.get("/api/settings/whatsapp/zernio")).json()).connection, null);
  await page.getByLabel("API key de Zernio").fill("settings-valid-key");
  assert((await submit("Guardar conexión Zernio", "/api/settings/whatsapp/zernio", "PUT")).ok());
  await page.reload();
  await page.getByText("+52 55 0000 0000", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("API key de Zernio").inputValue(), "");
  assert((await page.getByLabel("URL del webhook en Zernio").inputValue()).includes("/api/webhooks/zernio-whatsapp/"));
  await page.goto("/settings/zernio");
  await page.waitForURL("**/settings/whatsapp");
  console.log("OK: WhatsApp abre Zernio, rechaza key inválida, guarda y persiste la conexión");

  await page.getByRole("link", { name: "Google Calendar", exact: true }).click();
  await page.getByRole("heading", { name: "Conectar Google Calendar + Meet", exact: true }).waitFor();
  await page.getByLabel("Client ID", { exact: true }).fill("settings.apps.googleusercontent.com");
  await page.getByLabel("Client Secret", { exact: true }).fill("google-local-secret");
  await page.getByLabel("Refresh token", { exact: true }).fill("refresh-invalid");
  await page.getByLabel("Calendario", { exact: true }).fill("primary");
  assert.equal((await submit("Conectar", "/api/settings/google", "PUT")).status(), 422);
  assert.equal((await (await context.request.get("/api/settings/google")).json()).connection, null);
  await page.getByLabel("Refresh token", { exact: true }).fill("refresh-valid");
  assert((await submit("Probar", "/api/settings/google/test", "POST")).ok());
  assert((await submit("Conectar", "/api/settings/google", "PUT")).ok());
  await page.getByText("Google Calendar + Meet conectado", { exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Actualizar", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Client ID", { exact: true }).inputValue(), "settings.apps.googleusercontent.com");
  assert.equal(await page.getByLabel("Client Secret", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("Refresh token", { exact: true }).inputValue(), "");
  console.log("OK: Google Calendar accesible, validación real contra mock y credenciales persistidas sin exponer secretos");

  await page.goto("/settings/messenger");
  await page.getByRole("button", { name: "Zernio (API unificada)", exact: true }).click();
  await page.getByLabel("accountId de Zernio").fill("messenger-settings-e2e");
  await page.getByLabel("API key de Zernio").fill("messenger-valid-key");
  assert((await submit("Probar y guardar", "/api/settings/messenger", "PUT")).ok());
  await page.getByText("Conexión guardada ✓", { exact: true }).waitFor();
  await page.getByLabel("API key de Zernio").fill("messenger-valid-key");
  await page.route("**/api/settings/messenger", async (route) => {
    if (route.request().method() === "PUT") return route.fulfill({ status: 502, contentType: "text/html", body: "Bad Gateway" });
    return route.continue();
  });
  await submit("Probar y guardar", "/api/settings/messenger", "PUT");
  await page.getByText(/respuesta inesperada \(HTTP 502\)/).waitFor();
  console.log("OK: Messenger guarda con Zernio y distingue errores del proxy (HTTP 502)");
} finally {
  await browser.close();
}
