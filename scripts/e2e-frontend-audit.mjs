/** Browser regression: independent provider pages + personal calendar.
 * APP_BASE_URL, E2E_EMAIL, E2E_PASSWORD; local default account is bootstrapped.
 * Production requires an explicitly supplied audit account. Only its tasks and
 * preferences are changed; provider credentials are never submitted.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.APP_BASE_URL ?? "http://localhost:3199";
const local = ["localhost", "127.0.0.1"].includes(new URL(base).hostname);
const email = process.env.E2E_EMAIL ?? (local ? "e2e@vocero.test" : "");
const password = process.env.E2E_PASSWORD ?? (local ? "password-e2e-123" : "");
assert(email && password, "Provide an audit account for production");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
const prefix = `Auditoría ${Date.now()}`;
const createdIds = [];
let originalSettings;
let checks = 0;
function check(name, condition = true) { assert(condition, name); console.log(`OK ${++checks}: ${name}`); }
async function api(path, method = "GET", data) {
  return context.request.fetch(`${base}${path}`, { method, data, headers: { origin: base } });
}
async function savedRequest(action, path, method) {
  const pending = page.waitForResponse((r) => new URL(r.url()).pathname === path && r.request().method() === method);
  await action(); const response = await pending;
  assert(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
  return response;
}
async function screenshot(name) {
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${name}.png`, fullPage: true, animations: "disabled" });
}
async function noOverflow(name) {
  const sizes = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  check(`${name}: sin desbordamiento horizontal`, sizes.scroll <= sizes.width + 1);
}

try {
  if (local) await api("/api/auth/sign-up/email", "POST", { email, password, name: "Operador E2E" });
  await page.goto(`${base}/login`);
  await page.getByLabel("Correo", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.locator('aside a[href="/todo"]').waitFor({ state: "visible" });
  check("Inicio de sesión real y Calendario en el menú");
  if (local) {
    const stale = (await (await api("/api/caltodo/tasks")).json()).tasks;
    for (const task of stale.filter((t) => t.title.startsWith("Auditoría "))) await api(`/api/caltodo/tasks?id=${task.id}`, "DELETE");
  }

  for (const [path, label] of [["whatsapp", "Meta Business"], ["waha", "WAHA"], ["zernio", "Zernio"]]) {
    const response = await page.goto(`${base}/settings/${path}`);
    check(`${label}: página responde`, response.status() === 200);
    await page.locator(`nav a[href="/settings/${path}"]`).waitFor({ state: "visible" });
    check(`${label}: sin selector de proveedor`, await page.getByText("Proveedor activo de WhatsApp", { exact: true }).count() === 0);
    if (path === "waha") {
      await page.getByLabel("Nombre del dispositivo", { exact: true }).waitFor({ state: "visible" });
      await page.getByLabel("Reintentos", { exact: true }).waitFor({ state: "visible" });
      await page.getByLabel("Usuario del proxy", { exact: true }).waitFor({ state: "visible" });
      check("WAHA: dispositivo, eventos, reintentos y proxy visibles");
    }
    if (path === "zernio") {
      await page.getByLabel("Account ID de WhatsApp", { exact: true }).waitFor({ state: "visible" });
      await page.getByLabel("Secreto de firma del webhook", { exact: true }).waitFor({ state: "visible" });
      check("Zernio: formulario propio y configuración del webhook");
    }
    await screenshot(`settings-${path}`);
  }

  originalSettings = (await (await api("/api/caltodo/settings")).json()).settings;
  await page.goto(`${base}/todo`);
  await page.getByRole("tab", { name: "Configuración", exact: true }).click();
  await page.getByLabel("Inicio", { exact: true }).selectOption("0");
  await page.getByLabel("Fin", { exact: true }).selectOption("24");
  await page.getByLabel("Zona horaria", { exact: true }).selectOption("UTC");
  await page.getByLabel("30 min", { exact: true }).check();
  await savedRequest(() => page.getByRole("button", { name: "Guardar", exact: true }).click(), "/api/caltodo/settings", "PATCH");
  await page.getByRole("status").filter({ hasText: "Configuración guardada" }).waitFor();
  await page.reload();
  await page.getByRole("tab", { name: "Configuración", exact: true }).click();
  check("Configuración persiste al recargar", await page.getByLabel("Inicio", { exact: true }).inputValue() === "0" && await page.getByLabel("Fin", { exact: true }).inputValue() === "24" && await page.getByLabel("Zona horaria", { exact: true }).inputValue() === "UTC");
  check("Duración por defecto persiste", await page.getByLabel("30 min", { exact: true }).isChecked());
  for (const bad of [{ workStartHour: 24 }, { workStartHour: 23, workEndHour: 1 }, { timezone: "Invalid/Zone" }]) check("API rechaza configuración inválida", (await api("/api/caltodo/settings", "PATCH", bad)).status() === 422);
  await screenshot("calendar-settings");

  await page.route("**/api/caltodo/settings", async (route) => {
    if (route.request().method() === "PATCH") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Fallo simulado de guardado" } }) });
    else await route.continue();
  });
  await page.getByRole("button", { name: /Guardar|Guardado/, exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Fallo simulado" }).waitFor();
  check("Error de guardado visible y botón recuperable", await page.getByRole("button", { name: "Guardar", exact: true }).isEnabled());
  await page.unroute("**/api/caltodo/settings");
  await savedRequest(() => page.getByRole("button", { name: "Guardar", exact: true }).click(), "/api/caltodo/settings", "PATCH");
  check("Reintento de guardado funciona");

  await page.getByRole("tab", { name: "Lista", exact: true }).click();
  for (const suffix of ["A", "B"]) {
    await page.getByLabel("Título de la tarea", { exact: true }).fill(`${prefix} ${suffix}`);
    const response = await savedRequest(() => page.getByRole("button", { name: "Crear", exact: true }).click(), "/api/caltodo/tasks", "POST");
    createdIds.push((await response.json()).task.id);
    await page.getByText(`${prefix} ${suffix}`, { exact: true }).waitFor();
  }
  check("Crear tareas desde el formulario");
  await page.getByRole("tab", { name: "Calendario", exact: true }).click();
  await page.getByText(`${prefix} A`, { exact: true }).waitFor();
  await page.getByText(`${prefix} B`, { exact: true }).waitFor();
  check("Calendario recibe las tareas sin recargar");
  await page.getByRole("button", { name: "Día", exact: true }).click();
  await page.getByText(`${prefix} A`, { exact: true }).waitFor();
  check("Vista diaria muestra las tareas");
  await page.getByText(`${prefix} A`, { exact: true }).scrollIntoViewIfNeeded();
  await screenshot("calendar-day");
  await page.getByRole("button", { name: "Semana", exact: true }).click();
  await page.getByText(`${prefix} A`, { exact: true }).scrollIntoViewIfNeeded();
  await screenshot("calendar-week");
  await page.getByRole("tab", { name: "Lista", exact: true }).click();
  const drag = page.getByRole("button", { name: `Reordenar ${prefix} A`, exact: true });
  await drag.focus();
  await drag.press("Space");
  await drag.press("ArrowDown");
  await savedRequest(() => drag.press("Space"), "/api/caltodo/tasks/reorder", "POST");
  let tasks = (await (await api("/api/caltodo/tasks")).json()).tasks;
  check("Reordenar con teclado persiste en la API", tasks.find((t) => t.id === createdIds[1]).priority < tasks.find((t) => t.id === createdIds[0]).priority);
  await savedRequest(() => page.getByRole("button", { name: "Reprogramar todo", exact: true }).click(), "/api/caltodo/tasks/reschedule", "POST");
  tasks = (await (await api("/api/caltodo/tasks")).json()).tasks;
  check("Reprogramar respeta el orden nuevo", new Date(tasks.find((t) => t.id === createdIds[1]).scheduledStart) < new Date(tasks.find((t) => t.id === createdIds[0]).scheduledStart));
  await page.getByRole("button", { name: `Editar ${prefix} A`, exact: true }).click();
  await page.getByLabel("Título de la tarea", { exact: true }).fill(`${prefix} Editada`);
  await savedRequest(() => page.getByRole("button", { name: "Guardar tarea", exact: true }).click(), "/api/caltodo/tasks", "PATCH");
  await page.getByText(`${prefix} Editada`, { exact: true }).waitFor();
  check("Edición visible y persistida");
  await savedRequest(() => page.getByRole("checkbox", { name: `Completar ${prefix} Editada`, exact: true }).click(), "/api/caltodo/tasks", "PATCH");
  await page.getByRole("button", { name: /Completadas/ }).waitFor();
  await page.getByRole("tab", { name: "Calendario", exact: true }).click();
  check("Completar retira la tarea del calendario", await page.getByText(`${prefix} Editada`, { exact: true }).count() === 0);
  await page.getByRole("tab", { name: "Lista", exact: true }).click();
  await page.getByRole("button", { name: /Completadas/ }).click();
  await savedRequest(() => page.getByRole("button", { name: "Rehacer", exact: true }).click(), "/api/caltodo/tasks", "PATCH");
  await page.getByRole("checkbox", { name: `Completar ${prefix} Editada`, exact: true }).waitFor();
  check("Reabrir una tarea la devuelve a pendientes");
  await screenshot("calendar-list");
  page.once("dialog", (dialog) => dialog.accept());
  await savedRequest(() => page.getByRole("button", { name: `Eliminar ${prefix} Editada`, exact: true }).click(), "/api/caltodo/tasks", "DELETE");
  await page.getByText(`${prefix} Editada`, { exact: true }).waitFor({ state: "hidden" });
  check("Eliminar una tarea desde la interfaz");

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow("Lista móvil");
  await page.getByRole("tab", { name: "Calendario", exact: true }).click();
  await noOverflow("Calendario semanal móvil");
  await screenshot("calendar-mobile");
  await page.getByRole("tab", { name: "Configuración", exact: true }).click();
  await noOverflow("Configuración móvil");
  for (const path of ["whatsapp", "waha", "zernio"]) { await page.goto(`${base}/settings/${path}`); await noOverflow(`Ajustes ${path} móvil`); }
  await page.setViewportSize({ width: 1440, height: 1050 });
  for (const path of ["dashboard", "inbox", "pipeline", "contacts", "balance", "quotes", "projects", "tareas", "lab", "settings/business", "settings/templates", "settings/agent", "settings/webhooks"]) {
    const response = await page.goto(`${base}/${path}`);
    check(`Auditoría de navegación: /${path}`, response.status() === 200);
  }
  check("Sin errores de ejecución de React", pageErrors.length === 0 || (console.error(pageErrors), false));
  console.log(`PASS: ${checks} verificaciones de frontend en ${base}`);
} finally {
  try {
    for (const id of createdIds) await api(`/api/caltodo/tasks?id=${id}`, "DELETE").catch(() => console.error("No se pudo limpiar una tarea de prueba"));
    if (originalSettings) await api("/api/caltodo/settings", "PATCH", originalSettings).catch(() => console.error("No se pudo restaurar configuración de prueba"));
  } finally { await browser.close(); }
}
