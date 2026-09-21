/**
 * App real + PostgreSQL + Zernio mock. Solo ejecutar contra localhost con
 * WA_MOCK_ENABLED=true, CHANNELS=whatsapp,instagram y ZERNIO_BASE_URL al mock.
 * APP_BASE_URL=http://localhost:3147 META_WEBHOOK_VERIFY_TOKEN=... node scripts/e2e-instagram-disconnect.mjs
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const verify = process.env.META_WEBHOOK_VERIFY_TOKEN;
assert.ok(verify, "Falta META_WEBHOOK_VERIFY_TOKEN de pruebas");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: base });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const id = Date.now().toString(36);
const accountA = `ig-a-${id}`;
const accountB = `ig-b-${id}`;
const api = context.request;
const settings = "/api/settings/instagram";
const checkState = async () => (await api.get(settings)).json();

async function connect(account) {
  await page.getByLabel("accountId de Zernio").fill(account);
  await page.getByLabel("API key de Zernio").fill("token-demo-instagram");
  const response = page.waitForResponse((r) => r.url().endsWith(settings) && r.request().method() === "PUT");
  await page.getByRole("button", { name: "Probar y guardar" }).click();
  assert.equal((await response).status(), 200);
  await page.getByText(`Cuenta ${account}`, { exact: false }).waitFor();
  assert.equal((await checkState()).connection.accountRef, account);
}

try {
  const signup = await api.post("/api/auth/sign-up/email", {
    headers: { origin: base },
    data: { email: `ig-${id}@example.test`, password: "test-password-instagram-123", name: "IG Test" },
  });
  assert.ok(signup.ok(), `signup: ${signup.status()}`);
  await page.goto(`${base}/settings/instagram`);
  await connect(accountA);

  // Una conversación real ingresada mediante el proveedor simulado.
  const hook = await api.post(`/api/webhooks/ig/${verify}`, {
    data: {
      event: "message.received", account: { id: accountA, platform: "instagram" },
      message: {
        id: `msg-${id}`, conversationId: `thread-${id}`, direction: "incoming",
        text: "Historial que debe conservarse", sentAt: new Date().toISOString(),
        sender: { id: `sender-${id}`, name: "Cliente Instagram" },
      },
    },
  });
  assert.equal(hook.status(), 200);
  let previous = [];
  for (let n = 0; n < 40; n++) {
    const data = await (await api.get("/api/conversations")).json();
    previous = data.conversations ?? [];
    if (previous.length) break;
    await page.waitForTimeout(250);
  }
  assert.equal(previous.length, 1, "Se ingresa el mensaje de A");

  // Error HTTP: no debe mostrar una desconexión ficticia ni borrar campos.
  await page.route(`**${settings}`, (route) => route.request().method() === "DELETE"
    ? route.fulfill({ status: 500, json: { error: { message: "Fallo de prueba" } } })
    : route.continue());
  await page.getByRole("button", { name: "Desconectar Instagram", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Fallo de prueba" }).waitFor();
  assert.equal(await page.getByLabel("accountId de Zernio").inputValue(), accountA);
  assert.equal((await checkState()).connection.accountRef, accountA);
  await page.unroute(`**${settings}`);

  // Error de red: mantiene la conexión y permite reintentar.
  await page.route(`**${settings}`, (route) => route.request().method() === "DELETE"
    ? route.abort("failed") : route.continue());
  await page.getByRole("button", { name: "Desconectar Instagram", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "No se pudo desconectar" }).waitFor();
  assert.equal((await checkState()).connection.accountRef, accountA);
  await page.unroute(`**${settings}`);

  // Una cuenta vencida también ofrece desconexión. Solo GET se simula aquí;
  // DELETE/PUT siguen usando la app y la BD reales.
  await page.route(`**${settings}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const json = await response.json();
    if (json.connection) json.connection.status = "reconnect_required";
    await route.fulfill({ response, json });
  });
  await page.reload();
  await page.getByText("El token expiró o fue revocado.").waitFor();
  await page.getByRole("button", { name: "Desconectar Instagram", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Instagram desvinculado" }).waitFor();
  assert.equal((await checkState()).connection, null);
  for (const label of ["accountId de Zernio", "API key de Zernio", "Secreto del webhook (opcional)"]) {
    assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), "");
  }
  assert.equal((await api.delete(settings)).status(), 200, "DELETE idempotente");
  await page.unroute(`**${settings}`);
  await connect(accountB);
  await page.reload();
  await page.getByText(`Cuenta ${accountB}`, { exact: false }).waitFor();
  const after = await (await api.get("/api/conversations")).json();
  assert.deepEqual(after.conversations.map((c) => c.id), previous.map((c) => c.id));
  console.log("OK: conexión A → errores HTTP/red → desconexión de cuenta vencida → conexión B → recarga; historial conservado.");
} finally {
  await browser.close();
}
