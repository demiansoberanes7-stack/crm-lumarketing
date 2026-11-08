/**
 * E2E de la entrega durable: el mock recibe el webhook público real, el ACK
 * vuelve mientras el worker está pausado, y un worker nuevo recupera la fila
 * persistida. Luego se reentrega el mismo mensaje y se afirma la deduplicación.
 *
 * Requiere app local viva, WA_MOCK_ENABLED=true y credenciales de prueba en .env.
 */
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const VERIFY = process.env.META_WEBHOOK_VERIFY_TOKEN;
const PN = "PN-WEBHOOK-DURABLE-E2E";
const RUN = Date.now().toString(36);
let cookie = "";
let failures = 0;

function ok(name, condition, extra = "") {
  if (condition) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((value) => value.split(";")[0]).join("; ");
  const json = await res.clone().json().catch(() => null);
  return { res, json };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await sleep(250);
  }
  return false;
}

async function main() {
  let local = false;
  try {
    local = ["localhost", "127.0.0.1", "::1"].includes(new URL(BASE).hostname);
  } catch {}
  if (!local || process.env.WA_MOCK_ENABLED !== "true" || !VERIFY) {
    console.error("Este guion solo corre en localhost con WA_MOCK_ENABLED=true y META_WEBHOOK_VERIFY_TOKEN definido.");
    process.exit(1);
  }

  const email = "e2e@zorro.test";
  const password = "password-e2e-123";
  let auth = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!auth.res.ok) {
    auth = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }
  ok("sesión de prueba autenticada", auth.res.ok);
  if (!auth.res.ok) process.exit(1);

  const connection = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-WEBHOOK-DURABLE", phoneNumberId: PN, token: "tok-webhook-durable" }),
  });
  ok("cuenta del mock conectada", connection.res.ok);
  if (!connection.res.ok) process.exit(1);

  const paused = await api("/api/dev/wa-mock/webhook-worker", {
    method: "POST",
    body: JSON.stringify({ action: "pause" }),
  });
  ok("worker pausado para simular interrupción tras el ACK", paused.res.ok);
  if (!paused.res.ok) process.exit(1);

  const contactName = `WebhookDurable${RUN}`;
  const inbound = {
    phoneNumberId: PN,
    from: `521462${String(Date.now()).slice(-7)}`,
    name: contactName,
    text: `mensaje durable ${RUN}`,
    waMessageId: `wamid.durable.${RUN}`,
    timestamp: Math.floor(Date.now() / 1000),
  };
  const delivered = await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify(inbound),
  });
  ok("el webhook público respondió ACK después de guardar el evento", delivered.res.ok && delivered.json?.delivered === true);

  const listBeforeRestart = await api("/api/conversations");
  ok(
    "con el worker detenido el evento persiste pendiente y aún no ingresa el mensaje",
    listBeforeRestart.res.ok && !listBeforeRestart.json?.conversations?.some((item) => item.contact.name === contactName)
  );

  const restarted = await api("/api/dev/wa-mock/webhook-worker", {
    method: "POST",
    body: JSON.stringify({ action: "restart" }),
  });
  ok("el worker al reiniciar reclama la fila PostgreSQL", restarted.res.ok && (restarted.json?.result?.processed ?? 0) >= 1);

  let conversation = null;
  const arrived = await until(async () => {
    const list = await api("/api/conversations");
    conversation = list.json?.conversations?.find((item) => item.contact.name === contactName) ?? null;
    return Boolean(conversation);
  });
  ok("el mensaje quedó procesado después del reinicio", arrived);
  if (conversation) {
    const before = await api(`/api/conversations/${conversation.id}/messages`);
    const countBefore = (before.json?.messages ?? []).filter((message) => message.text === inbound.text).length;
    ok("se persistió un solo mensaje", countBefore === 1, `filas=${countBefore}`);

    const duplicate = await api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify(inbound),
    });
    ok("el proveedor reintentó y recibió ACK", duplicate.res.ok);
    await sleep(1_200);
    const after = await api(`/api/conversations/${conversation.id}/messages`);
    const countAfter = (after.json?.messages ?? []).filter((message) => message.text === inbound.text).length;
    ok("la reentrega no duplicó la fila visible", countAfter === 1, `filas=${countAfter}`);
  }

  await api("/api/dev/wa-mock/webhook-worker", {
    method: "POST",
    body: JSON.stringify({ action: "restart" }),
  });
  if (failures > 0) process.exit(1);
  console.log("E2E de webhooks durables: todo verde.");
}

main().catch((error) => {
  console.error("E2E de webhooks durables falló:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
