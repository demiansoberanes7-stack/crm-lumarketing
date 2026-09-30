/**
 * E2E de WEBHOOKS DE SALIDA (no confundir con los entrantes de Meta).
 *
 * Cubre lo que el unit test no puede: el circuito completo contra la app viva —
 * crear un webhook, disparar un evento REAL desde el CRM, recibirlo en el sink
 * con la firma HMAC verificable, ver la fila `outbound_delivery` en Éxito y
 * probar el botón "Probar envío" desde la UI.
 *
 * Requisitos (igual que el resto del arnés):
 *   WA_MOCK_ENABLED=true               → existe /api/dev/webhook-sink
 *   WEBHOOK_TRUSTED_HOSTS=<hostname>   → el sink corre por http://localhost
 *
 *   APP_BASE_URL=http://localhost:3310 pnpm test:e2e:webhooks
 */
import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3310";
const hostname = new URL(BASE).hostname;
assert(
  ["localhost", "127.0.0.1"].includes(hostname),
  `APP_BASE_URL debe apuntar a localhost (recibido: ${BASE})`
);

const SINK = `${BASE}/api/dev/webhook-sink`;
const SECRET = "e2e-outbound-secret";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hasta(cond, ms = 20000, paso = 400) {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await cond().catch(() => null);
    if (v) return v;
    if (Date.now() > fin) throw new Error("timeout esperando la condición");
    await sleep(paso);
  }
}

function verificarFirma(raw, header, secret) {
  const esperada = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const dada = String(header ?? "").replace(/^sha256=/, "");
  assert.equal(dada.length, esperada.length, "longitud de firma distinta");
  assert.ok(timingSafeEqual(Buffer.from(dada), Buffer.from(esperada)), "firma HMAC no coincide");
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: BASE });
context.setDefaultTimeout(60000);
const page = await context.newPage();

let webhookId = null;

try {
  // El registro solo crea organización en una instancia VACÍA; en una BD ya
  // poblada el propietario es otra cuenta, así que las credenciales se pueden
  // mandar por env y si no, se intenta con la cuenta E2E del repo.
  const EMAIL = process.env.E2E_OWNER_EMAIL ?? "e2e@vocero.test";
  const PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "password-e2e-123";
  const credentials = { email: EMAIL, password: PASSWORD, name: "Webhooks E2E" };

  let auth = await context.request.post("/api/auth/sign-up/email", {
    data: credentials,
    headers: { origin: BASE },
  });
  if (!auth.ok()) {
    auth = await context.request.post("/api/auth/sign-in/email", {
      data: { email: EMAIL, password: PASSWORD },
      headers: { origin: BASE },
    });
  }
  assert(auth.ok(), `registro/login → ${auth.status()}`);

  // Un 401 aquí no es un bug del guión: la cuenta no es dueña de la org.
  const probe = await context.request.get("/api/settings/webhooks");
  assert(
    probe.status() !== 401,
    `${EMAIL} no tiene organización activa en esta BD. ` +
      `Manda E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD con el propietario real.`
  );

  // El sink vive tras mockGuard(): 404 = los mocks no están encendidos.
  const sinkRes = await context.request.delete(SINK);
  assert.equal(sinkRes.status(), 200, "el sink no existe: enciende WA_MOCK_ENABLED=true");

  // 1 · Crear el webhook apuntando al propio CRM (http://localhost es válido
  //     porque el host está en WEBHOOK_TRUSTED_HOSTS).
  const creado = await context.request.post("/api/settings/webhooks", {
    data: {
      name: "Sink E2E",
      url: SINK,
      secret: SECRET,
      events: ["contact.created"],
    },
  });
  assert.equal(creado.status(), 201, `crear webhook → ${creado.status()}`);
  webhookId = (await creado.json()).webhookId;

  // 2 · Un evento REAL del CRM (alta de contacto) debe cruzar el dispatcher.
  const phone = `52155${String(Date.now()).slice(-8)}`; // dígitos + código de país
  const contacto = await context.request.post("/api/contacts", {
    data: { name: "Contacto Webhooks", phone },
  });
  assert(contacto.ok(), `crear contacto → ${contacto.status()}`);

  const entregado = await hasta(async () => {
    const res = await context.request.get(SINK);
    if (!res.ok()) return null;
    const { received } = await res.json();
    return received.find((r) => r.event === "contact.created") ?? null;
  });
  assert.equal(entregado.event, "contact.created");
  verificarFirma(entregado.raw, entregado.signature, SECRET);
  console.log("OK: evento real recibido en el sink con firma HMAC verificable");

  // 3 · La fila de auditoría quedó en Éxito.
  const entregas = await hasta(async () => {
    const res = await context.request.get(
      `/api/settings/webhooks/${webhookId}/deliveries`
    );
    if (!res.ok()) return null;
    const data = await res.json();
    return data.deliveries.find((d) => d.event === "contact.created" && d.status === "delivered") ?? null;
  });
  assert.equal(entregas.lastStatusCode, 200, "la auditoría registró el 200");
  console.log("OK: outbound_delivery en Éxito con el código HTTP real");

  // 4 · "Probar envío" (ignora el filtro: el evento es webhook.test).
  const prueba = await context.request.post(
    `/api/settings/webhooks/${webhookId}/test`
  );
  assert(prueba.ok(), `probar envío → ${prueba.status()}`);
  const veredicto = await prueba.json();
  assert.equal(veredicto.ok, true, JSON.stringify(veredicto));
  assert.equal(veredicto.status, 200);
  console.log(`OK: Probar envío → 200 en ${veredicto.ms} ms`);

  // 5 · El historial de entregas se ve desde la UI.
  await page.goto("/settings/webhooks");
  await page.getByRole("heading", { name: "Webhooks de salida" }).waitFor();
  await page.getByTitle("Ver entregas").click();
  await page.getByText("Prueba manual").first().waitFor();
  await page.getByTitle("Probar envío").click();
  await page.getByText(/Entregado ✓ HTTP 200/).waitFor();
  console.log("OK: panel Entregas + botón Probar envío funcionan en la UI");

  // 6 · Superficie: la ruta legada ya no responde… y las URLs malas se cortan
  //     ANTES de apuntar a la red interna.
  const legado = await context.request.get("/api/settings/outbound-webhooks");
  assert.equal(legado.status(), 404, "la superficie legada sigue viva");

  const httpAbierto = await context.request.post("/api/settings/webhooks", {
    data: {
      name: "Inseguro",
      url: "http://ejemplo-no-confiable.com/hook",
      events: ["contact.created"],
    },
  });
  assert.equal(httpAbierto.status(), 422, "http sin host autorizado debió rechazarse");

  const metadatos = await context.request.post("/api/settings/webhooks", {
    data: {
      name: "SSRF",
      url: "https://169.254.169.254/latest/meta-data/",
      events: ["contact.created"],
    },
  });
  assert.equal(metadatos.status(), 422, "la IP de metadatos debió rechazarse");
  const cuerpo = await metadatos.json();
  assert.equal(cuerpo.error.code, "invalid_url");
  console.log("OK: ruta legada en 404 y SSRF bloqueado al crear (422)");
} finally {
  if (webhookId) {
    await context.request.delete(`/api/settings/webhooks/${webhookId}`).catch(() => {});
  }
  await context.request.delete(SINK).catch(() => {});
  await browser.close();
}
