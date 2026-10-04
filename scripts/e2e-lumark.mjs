/** Flujos locales de LUMARK: ejecutar contra la base de pruebas, después del self-test. */
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { chromium } from "playwright";

const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
// `next dev` en el contenedor de pruebas tarda 80–220 s por petición cuando
// el host está cargado: los timeouts son amplios a propósito.
page.setDefaultTimeout(240000);
page.setDefaultNavigationTimeout(300000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const suffix = Date.now();
const pngFixture = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPgjf5PEmIY1TCqYfhqAADpLGcQ7emRCgAAAABJRU5ErkJggg==", "base64");
let checks = 0;
function ok(label, condition = true) {
  assert.ok(condition, label);
  checks++;
  console.log(`OK ${label}`);
}
async function json(path) {
  const response = await page.request.get(`${base}${path}`, { timeout: 300000 });
  assert.ok(response.ok(), `${path}: ${response.status()}`);
  return response.json();
}
// `next dev` compila por ruta y con el host cargado un chunk tarda minutos:
// no esperamos `load` (se cuelga con los chunks lentos), solo el documento.
const NAV = { waitUntil: "domcontentloaded" };
/**
 * Espera a que React hidrate. Si se picota antes, el submit del login es
 * NATIVO (navega a `GET /login?`) y nunca llega el POST de sesión: de ahí
 * los "no navegó" intermitentes. React deja `__reactProps$…` en los nodos.
 */
async function hydrate() {
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector("button, a");
        return !!el && Object.keys(el).some((key) => key.startsWith("__reactProps"));
      },
      undefined,
      { timeout: 240000 }
    )
    .catch(() => {}); // best effort: el resto del guion tolera una página lenta
}
async function nav(path) {
  await page.goto(`${base}${path}`, NAV);
  await hydrate();
}
async function reload() {
  await page.reload(NAV);
  await hydrate();
}
/**
 * Escribe y comprueba que el valor "se queda": si la página aún no hidrató,
 * React repite el valor de su estado y borra lo escrito.
 */
async function type(selector, value) {
  for (let intento = 0; intento < 6; intento++) {
    await page.locator(selector).fill(value);
    await page.waitForTimeout(1000);
    if ((await page.locator(selector).inputValue()) === value) return;
  }
  throw new Error(`${selector} no retiene el valor escrito (¿página sin hidratar?)`);
}
async function save(path, buttonName = "Guardar") {
  const pending = page.waitForResponse((r) => r.url().endsWith(path) && r.request().method() === "POST");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const response = await pending;
  assert.ok(response.ok(), `${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
function pdfHasText(buf, text) {
  const source = buf.toString("latin1");
  const streams = [source];
  for (const match of source.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = buf.indexOf(Buffer.from("endstream"), start);
    if (end < 0) continue;
    const chunk = buf.subarray(start, end);
    for (const inflate of [zlib.inflateSync, zlib.inflateRawSync]) {
      try { streams.push(inflate(chunk).toString("latin1")); break; } catch { /* non-Flate */ }
    }
  }
  const content = streams.join("\n");
  const hex = Buffer.from(text, "latin1").toString("hex").toUpperCase();
  return content.includes(text) || content.includes(hex);
}
try {
  // Tres intentos: si la página no hidrató, el submit es nativo (`GET /login?`)
  // o el POST de sesión tarda más que el timeout; se reintenta solo eso.
  let logged = false;
  for (let intento = 1; intento <= 3 && !logged; intento++) {
    await nav("/login");
    await type('input[type="email"]', "e2e@vocero.test");
    await type('input[type="password"]', "password-e2e-123");
    await page.locator('button[type="submit"]').click();
    try {
      await page.waitForURL((url) => !url.pathname.includes("login"), NAV);
      logged = true;
    } catch {
      if (!page.url().includes("/login")) logged = true; // ya salió, el load no llegó
    }
  }
  assert.ok(logged, `la sesión de navegador no se estableció (URL: ${page.url()})`);
  ok("login desde navegador");

  await nav("/catalog");
  await page.getByRole("button", { name: "Nuevo Producto", exact: true }).click();
  await page.locator("#prod-name").fill(`Servicio ${suffix}`);
  await page.locator("#prod-price").fill("123.45");
  await save("/api/catalog", "Guardar producto");
  await page.getByText(`Servicio ${suffix}`, { exact: true }).waitFor();
  const product = (await json("/api/catalog")).products.find((p) => p.name === `Servicio ${suffix}`);
  ok("producto con centavos persistido y visible", product?.price === 12345);

  await page.getByRole("button", { name: `Editar Servicio ${suffix}` }).click();
  await page.locator("#prod-name").fill(`Servicio editado ${suffix}`);
  await page.locator("#prod-price").fill("234.56");
  const imageUpload = page.waitForResponse((r) => r.url().endsWith("/api/media/upload") && r.request().method() === "POST");
  await page.locator('input[type="file"]').setInputFiles({ name: "producto.png", mimeType: "image/png", buffer: pngFixture });
  const imageResponse = await imageUpload;
  assert.ok(imageResponse.ok(), `carga de imagen: ${imageResponse.status()}`);
  const productUpdate = page.waitForResponse((r) => r.url().endsWith(`/api/catalog/${product.id}`) && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  assert.ok((await productUpdate).ok());
  const edited = (await json("/api/catalog")).products.find((p) => p.id === product.id);
  ok("producto editable guarda precio correcto e imagen cargada", edited?.name === `Servicio editado ${suffix}` && edited.price === 23456 && edited.imageUrl?.includes("/catalog/"));

  // La pantalla Datos de Empresa debe permitir reemplazar un logo existente.
  const initialLogo = await page.request.post(`${base}/api/settings/business/logo`, {
    multipart: { file: { name: "logo-inicial.png", mimeType: "image/png", buffer: pngFixture } },
  });
  assert.ok(initialLogo.ok());
  await nav("/settings/business");
  // Dos botones con el mismo texto: la preview clicable y el botón del formulario.
  await page.getByRole("button", { name: "Cambiar logo", exact: true }).first().waitFor();
  const oldLogoSrc = await page.locator('img[alt="Logo"]').getAttribute("src");
  const logoReplace = page.waitForResponse((r) => r.url().endsWith("/api/settings/business/logo") && r.request().method() === "POST");
  await page.locator('input[type="file"]').setInputFiles({ name: "logo-nuevo.png", mimeType: "image/png", buffer: pngFixture });
  assert.ok((await logoReplace).ok());
  await page.waitForFunction((previous) => document.querySelector('img[alt="Logo"]')?.getAttribute("src") !== previous, oldLogoSrc);
  ok("Datos de Empresa permite reemplazar el logo y cambia la URL cacheada");

  await nav("/quotes");
  await page.getByRole("button", { name: "Nueva Cotización", exact: true }).click();
  await page.getByPlaceholder("Nombre del item").fill(`Partida ${suffix}`);
  await page.locator('input[type="number"]').nth(0).fill("2");
  await page.locator('input[type="number"]').nth(1).fill("123.45");
  const created = await save("/api/quotes", "Crear cotización");
  const { quote } = await json(`/api/quotes/${created.quoteId}`);
  ok("cotización calcula subtotal e IVA en centavos", quote.subtotal === 24690 && quote.taxAmount === 3950 && quote.total === 28640);
  const quotePdf = await page.request.get(`${base}/api/quotes/${created.quoteId}/pdf`);
  assert.ok(quotePdf.ok(), `PDF cotización: ${quotePdf.status()}`);
  const quotePdfBytes = Buffer.from(await quotePdf.body());
  ok("PDF de cotización muestra el IVA aplicado y su importe", pdfHasText(quotePdfBytes, "IVA (16%):") && pdfHasText(quotePdfBytes, "$39.50"));
  await page.getByText(quote.quoteNumber, { exact: true }).click();
  await page.getByText(/Válida hasta el/).waitFor();
  ok("detalle de cotización muestra su vigencia sin romper la pantalla");

  await nav("/projects");
  await page.getByRole("button", { name: /Nuevo proyecto/i }).click();
  // El picker pide tipo + nombre; sin tipo el botón de crear queda deshabilitado.
  await page.locator('[role="dialog"][aria-label="Nuevo proyecto"] button[aria-pressed]').first().click();
  await page.locator("#np-name").fill(`Proyecto ${suffix}`);
  await save("/api/projects", "Crear y continuar");
  await page.getByText(`Proyecto ${suffix}`, { exact: true }).waitFor();
  ok("proyecto creado desde formulario y visible en lista");

  await nav("/balance");
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
  await reload();
  await page.getByRole("heading", { name: "Balance General" }).waitFor();
  ok("balance con pagos guardados sobrevive recarga");

  await nav("/settings/email");
  // La bandeja de correo vive en Ajustes → Correo (el viejo /email redirige).
  await page.getByText("Configura tus cuentas IMAP/SMTP").waitFor();
  const response = await page.request.post(`${base}/api/email/accounts`, { timeout: 300000, data: {
    label: `Correo ${suffix}`, email: `test-${suffix}@example.test`, username: "test", password: "test-only-password",
    imapHost: "127.0.0.1", imapPort: 1993, smtpHost: "127.0.0.1", smtpPort: 1465,
  } });
  assert.ok(response.ok());
  const { accountId } = await response.json();
  const accounts = (await json("/api/email/accounts")).accounts;
  const account = accounts.find((a) => a.id === accountId);
  ok("cuenta email devuelve DTO sin credenciales", account?.email === `test-${suffix}@example.test` && !JSON.stringify(account).match(/password|cipher|passIv|passTag/i));
  await reload();
  await page.getByText(`Correo ${suffix}`, { exact: true }).waitFor();
  ok("cuenta email visible con sus datos correctos");
  const invalid = await page.request.post(`${base}/api/quotes`, { timeout: 300000, data: { items: [] } });
  ok("cotización vacía rechazada con 422", invalid.status() === 422);
  const missing = await page.request.post(`${base}/api/email/messages`, { timeout: 300000, data: {
    accountId: "missing-account", to: "test@example.test", subject: "Prueba", text: "Sin conexión externa",
  } });
  ok("cuenta inexistente devuelve error controlado", !missing.ok() && !!(await missing.json()).error);
  assert.deepEqual(errors, [], "errores JavaScript en navegador");
  ok("sin excepciones JavaScript en las pantallas verificadas");
  console.log(`LUMARK: ${checks} comprobaciones OK`);
} finally {
  await browser.close();
}
