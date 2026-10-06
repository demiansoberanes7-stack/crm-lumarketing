/** Prueba real del programador durable y sus métricas contra el stack E2E aislado. */
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
let cookie = "";
let failures = 0;
let checks = 0;

function check(name, condition, details = "") {
  checks++;
  if (condition) console.log(`  OK  ${name}`);
  else {
    failures++;
    process.exitCode = 1;
    console.log(`  FAIL ${name}${details ? ` — ${details}` : ""}`);
  }
}

async function api(path, method = "GET", body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) cookie = cookies.map((value) => value.split(";")[0]).join("; ");
  const json = await response.json().catch(() => null);
  return { response, json };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const auth = await api("/api/auth/sign-in/email", "POST", {
    email: "e2e@vocero.test",
    password: "password-e2e-123",
  });
  check("sesión de selftest disponible", auth.response.ok, JSON.stringify(auth.json));
  if (!auth.response.ok) return;

  const rule = {
    id: "followup-3d",
    name: "Seguimiento E2E",
    trigger: "Etapa Cotizado o inactividad",
    messageText: `Seguimiento automático E2E ${Date.now()}`,
    delayHours: 2,
    enabled: true,
    channel: "whatsapp",
  };
  const saveRule = await api("/api/automations/rules", "POST", { rules: [rule] });
  check("regla guarda una espera expresada en horas", saveRule.response.ok, JSON.stringify(saveRule.json));
  const saved = await api("/api/automations/rules");
  check("API conserva 2 horas (1440 minutos) sin convertirla a días", saved.json?.rules?.[0]?.delayHours === 2);

  // Canales: el selector debe conocer las cuentas conectadas de la instancia.
  const channels = await api("/api/automations/channels");
  const channelList = channels.json?.channels ?? [];
  const waChannel = channelList.find((item) => item.id === "whatsapp");
  const messengerChannel = channelList.find((item) => item.id === "messenger");
  check("endpoint de canales lista WhatsApp y Messenger", channels.response.ok && Boolean(waChannel) && Boolean(messengerChannel), JSON.stringify(channels.json));
  check("WhatsApp aparece conectado en el selftest (Zernio mock)", waChannel?.connected === true, JSON.stringify(waChannel));

  const initialMetrics = await api("/api/automations/metrics");
  const initial = initialMetrics.json?.metrics;
  check("métricas reales informan periodo y programador", initial?.periodDays === 30 && initial?.responseWindowDays === 7 && initial?.schedulerReady === true, JSON.stringify(initial));
  if (!initial) return;

  const conversations = await api("/api/conversations");
  const conversation = conversations.json?.conversations?.find((item) => item.channel === "whatsapp" && item.windowOpen);
  check("selftest dejó una conversación WhatsApp para comprobar el envío", Boolean(conversation));
  if (!conversation) return;

  const trigger = await api("/api/automations/followup", "POST", {
    conversationId: conversation.id,
    delayHours: 0,
  });
  check("disparo manual con 0 horas queda encolado", trigger.response.status === 200 && trigger.json?.scheduled && Boolean(trigger.json?.executionId), JSON.stringify(trigger.json));
  if (!trigger.response.ok) return;

  // El primer Graph mock tras una recompilación puede alcanzar el deadline de
  // 20 s; dejamos que la cola haga su reintento transitorio y verificamos éxito.
  const deadline = Date.now() + 150_000;
  let finalMetrics = initial;
  while (Date.now() < deadline) {
    await sleep(500);
    const current = await api("/api/automations/metrics");
    finalMetrics = current.json?.metrics ?? finalMetrics;
    if (finalMetrics.sent > initial.sent) break;
  }
  check("el worker envía el seguimiento desde la cola persistida", finalMetrics.sent > initial.sent, JSON.stringify({ before: initial.sent, after: finalMetrics.sent }));
  check("la métrica no usa los valores de demostración 24 / 34%", finalMetrics.sent !== 24 || finalMetrics.responseRate !== 34);

  // Coincidencia estricta de canal: con la regla en Messenger, un seguimiento
  // sobre una conversación WhatsApp debe cancelarse sin enviar nada.
  const mismatchRule = { ...rule, channel: "messenger" };
  const saveMismatch = await api("/api/automations/rules", "POST", { rules: [mismatchRule] });
  check("la regla acepta el canal Messenger", saveMismatch.response.ok, JSON.stringify(saveMismatch.json));
  const mismatchTrigger = await api("/api/automations/followup", "POST", {
    conversationId: conversation.id,
    delayHours: 0,
  });
  check("el disparo con canal no coincidente queda encolado", mismatchTrigger.response.status === 200, JSON.stringify(mismatchTrigger.json));
  if (mismatchTrigger.response.ok) {
    const cancelDeadline = Date.now() + 30_000;
    let mismatchMetrics = finalMetrics;
    while (Date.now() < cancelDeadline) {
      await sleep(1000);
      const current = await api("/api/automations/metrics");
      mismatchMetrics = current.json?.metrics ?? mismatchMetrics;
      if (mismatchMetrics.sent > finalMetrics.sent) break;
    }
    check("la conversación de otro canal se cancela y no envía", mismatchMetrics.sent === finalMetrics.sent, JSON.stringify({ before: finalMetrics.sent, after: mismatchMetrics.sent }));
  }
  const restore = await api("/api/automations/rules", "POST", { rules: [rule] });
  check("se restaura la regla original (WhatsApp)", restore.response.ok, JSON.stringify(restore.json));

  console.log(`AUTOMATIONS: ${checks - failures}/${checks} comprobaciones OK`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
