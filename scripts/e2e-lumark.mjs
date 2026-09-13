/** Flujos locales de LUMARK: ejecutar contra la base de pruebas, después del self-test. */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(90000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const suffix = Date.now();
let checks = 0;
function ok(label, condition = true) {
  assert.ok(condition, label);
  checks++;
  console.log(`OK ${label}`);
}
async function json(path) {
  const response = await page.request.get(`${base}${path}`, { timeout: 180000 });
  assert.ok(response.ok(), `${path}: ${response.status()}`);
  return response.json();
}
async function save(path, buttonName = "Guardar") {
  const pending = page.waitForResponse((r) => r.url().endsWith(path) && r.request().method() === "POST");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const response = await pending;
  assert.ok(response.ok(), `${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
try {
  await page.goto(`${base}/login`);
  await page.locator('input[type="email"]').fill("e2e@vocero.test");
  await page.locator('input[type="password"]').fill("password-e2e-123");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes("login"));
  ok("login desde navegador");

  await page.goto(`${base}/catalog`);
  await page.getByRole("button", { name: "Nuevo Producto", exact: true }).click();
  await page.locator("#prod-name").fill(`Servicio ${suffix}`);
  await page.locator("#prod-price").fill("123.45");
  await save("/api/catalog");
  await page.getByText(`Servicio ${suffix}`, { exact: true }).waitFor();
  const product = (await json("/api/catalog")).products.find((p) => p.name === `Servicio ${suffix}`);
  ok("producto con centavos persistido y visible", product?.price === 12345);

  await page.goto(`${base}/quotes`);
  await page.getByRole("button", { name: "Nueva Cotización", exact: true }).click();
  await page.getByPlaceholder("Nombre del item").fill(`Partida ${suffix}`);
  await page.locator('input[type="number"]').nth(0).fill("2");
  await page.locator('input[type="number"]').nth(1).fill("123.45");
  const created = await save("/api/quotes", "Crear cotización");
  const { quote } = await json(`/api/quotes/${created.quoteId}`);
  ok("cotización calcula subtotal e IVA en centavos", quote.subtotal === 24690 && quote.taxAmount === 3950 && quote.total === 28640);
  await page.getByText(quote.quoteNumber, { exact: true }).click();
  await page.getByText(/Válida hasta el/).waitFor();
  ok("detalle de cotización muestra su vigencia sin romper la pantalla");

  await page.goto(`${base}/projects`);
  await page.getByRole("button", { name: /Nuevo proyecto/i }).click();
  await page.getByLabel("Nombre", { exact: true }).fill(`Proyecto ${suffix}`);
  await save("/api/projects", "Crear proyecto");
  await page.getByText(`Proyecto ${suffix}`, { exact: true }).waitFor();
  ok("proyecto creado desde formulario y visible en lista");

  await page.goto(`${base}/balance`);
  const before = (await json("/api/finances/balance")).balance;
  await page.getByRole("button", { name: "Registrar Gasto", exact: true }).click();
  await page.locator("#expense-descripcion").fill(`Gasto ${suffix}`);
  await page.locator("#expense-monto").fill("25.35");
  await save("/api/expenses");
  await page.getByText(`Gasto ${suffix}`, { exact: true }).waitFor();
  await page.getByRole("button", { name: "Registrar Pago", exact: true }).click();
  await page.locator("#payment-monto").fill("100.10");
  await save("/api/charges");
  const after = (await json("/api/finances/balance")).balance;
  ok("pago y gasto actualizan balance sin perder centavos", after.ingresos - before.ingresos === 10010 && after.egresos - before.egresos === 2535 && after.balance - before.balance === 7475);
  await page.reload();
  await page.getByRole("heading", { name: "Balance General" }).waitFor();
  ok("balance con pagos guardados sobrevive recarga");

  await page.goto(`${base}/email`);
  await page.getByRole("heading", { name: "Cuentas", exact: true }).waitFor();
  const response = await page.request.post(`${base}/api/email/accounts`, { timeout: 180000, data: {
    label: `Correo ${suffix}`, email: `test-${suffix}@example.test`, username: "test", password: "test-only-password",
    imapHost: "127.0.0.1", imapPort: 1993, smtpHost: "127.0.0.1", smtpPort: 1465,
  } });
  assert.ok(response.ok());
  const { accountId } = await response.json();
  const accounts = (await json("/api/email/accounts")).accounts;
  const account = accounts.find((a) => a.id === accountId);
  ok("cuenta email devuelve DTO sin credenciales", account?.email === `test-${suffix}@example.test` && !JSON.stringify(account).match(/password|cipher|passIv|passTag/i));
  await page.reload();
  await page.getByText(`Correo ${suffix}`, { exact: true }).waitFor();
  ok("cuenta email visible con sus datos correctos");
  const invalid = await page.request.post(`${base}/api/quotes`, { timeout: 180000, data: { items: [] } });
  ok("cotización vacía rechazada con 422", invalid.status() === 422);
  const missing = await page.request.post(`${base}/api/email/messages`, { timeout: 180000, data: {
    accountId: "missing-account", to: "test@example.test", subject: "Prueba", text: "Sin conexión externa",
  } });
  ok("cuenta inexistente devuelve error controlado", !missing.ok() && !!(await missing.json()).error);
  assert.deepEqual(errors, [], "errores JavaScript en navegador");
  ok("sin excepciones JavaScript en las pantallas verificadas");
  console.log(`LUMARK: ${checks} comprobaciones OK`);
} finally {
  await browser.close();
}
