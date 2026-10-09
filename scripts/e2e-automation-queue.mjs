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
    // Clave explícita: el texto legacy también activaría el barrido de
    // inactividad, que encola para todos los leads mudos y ensuciaría las
    // comprobaciones de envío de este mismo guion.
    triggers: ["stage_change"],
    messageText: `Seguimiento automático E2E ${Date.now()}`,
    delayHours: 2,
    enabled: true,
    channel: "whatsapp",
  };
  const saveRule = await api("/api/automations/rules", "POST", { rules: [rule] });
  check("regla guarda una espera expresada en horas", saveRule.response.ok, JSON.stringify(saveRule.json));
  const saved = await api("/api/automations/rules");
  check("API conserva 2 horas (1440 minutos) sin convertirla a días", saved.json?.rules?.[0]?.delayHours === 2);
  check("la API devuelve las claves de disparo además del texto", saved.json?.rules?.[0]?.triggers?.[0] === "stage_change", JSON.stringify(saved.json?.rules?.[0]));

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

  // ===== Disparos automáticos: nadie pulsa "Disparar manualmente" =====
  // Todo se apoya en el endpoint de ejecuciones, que dice qué regla, por qué
  // disparo y si salió — contar métricas globales no alcanzaría para saberlo.
  const sinceIso = new Date(Date.now() - 2000).toISOString();
  const esperar = async (ruleId, triggeredBy, estado, ms = 60_000) => {
    const fin = Date.now() + ms;
    let rows = [];
    for (;;) {
      const r = await api(
        `/api/automations/executions?ruleId=${encodeURIComponent(ruleId)}` +
          `&since=${encodeURIComponent(sinceIso)}&limit=200`
      );
      rows = (r.json?.executions ?? []).filter((e) => e.triggeredBy === triggeredBy);
      const listo =
        estado === "alguno"
          ? rows.length > 0
          : rows.some((e) => e.status === estado);
      if (listo) return rows;
      if (Date.now() > fin) return rows;
      await sleep(1000);
    }
  };

  const stages = (await api("/api/pipeline/stages")).json?.stages ?? [];
  const stageRule = { ...rule, delayHours: 0 };
  const welcomeRule = {
    ...rule,
    id: "welcome",
    name: "Bienvenida E2E",
    trigger: "Nuevo lead entra al pipeline",
    triggers: ["new_lead"],
    delayHours: 0,
    messageText: `Bienvenida E2E ${Date.now()}`,
  };
  const inactivityRule = {
    ...rule,
    id: "inactivity-e2e",
    name: "Inactividad E2E",
    trigger: "Sin actividad durante la espera",
    triggers: ["inactivity"],
    delayHours: 0,
    messageText: `Inactividad E2E ${Date.now()}`,
  };
  const guardadas = await api("/api/automations/rules", "POST", {
    rules: [stageRule, welcomeRule, inactivityRule],
  });
  check("se arman las tres reglas automáticas", guardadas.response.ok, JSON.stringify(guardadas.json));

  // Un número que nunca escribió entra por el webhook: nacen contacto,
  // conversación y lead — y el trigger "nuevo lead" tiene que dispararse solo.
  const marca = Date.now();
  const telefono = `5214630${String(marca).slice(-7)}`;
  const inbound = await api("/api/dev/wa-mock/inbound", "POST", {
    phoneNumberId: "PN-E2E-1",
    from: telefono,
    name: "Lead Automations",
    text: "hola, vi su anuncio",
    waMessageId: `wamid.e2e.auto.${marca}`,
  });
  check("un lead nuevo entra por el webhook de verdad", inbound.response.ok, JSON.stringify(inbound.json));

  const bienvenida = await esperar("welcome", "new_lead", "sent", 60_000);
  check(
    "el alta del lead dispara la bienvenida sin que nadie la inicie",
    bienvenida.length > 0 && bienvenida.some((e) => e.status === "sent"),
    JSON.stringify(bienvenida)
  );

  // El contacto se busca por sus dígitos: el teléfono viaja normalizado
  // (521 → 52), así que casar contra la lista cruda fallaría.
  const digitos = String(marca).slice(-7);
  let contactoNuevo = null;
  for (let i = 0; i < 20 && !contactoNuevo; i++) {
    const lista = (await api(`/api/contacts?q=${encodeURIComponent(telefono)}`)).json?.contacts ?? [];
    contactoNuevo = lista.find((c) => (c.phone ?? "").includes(digitos)) ?? null;
    if (!contactoNuevo) await sleep(400);
  }
  check("el mensaje entrante dejó el contacto en el directorio", Boolean(contactoNuevo), telefono);
  const detalle = contactoNuevo ? await api(`/api/contacts/${contactoNuevo.id}`) : null;
  const leadId = detalle?.json?.lead?.id ?? null;
  const etapaActual = detalle?.json?.stage?.id ?? null;
  const destino =
    stages.find((s) => s.id !== etapaActual && s.kind === "open") ??
    stages.find((s) => s.id !== etapaActual && s.kind !== "lost");
  check("hay una etapa distinta a la que mover la tarjeta", Boolean(destino), JSON.stringify(stages.map((s) => s.id)));
  if (leadId && destino) {
    const mover = await api(`/api/pipeline/leads/${leadId}`, "PATCH", { stageId: destino.id });
    check("mover la tarjeta no devuelve error", mover.response.ok, JSON.stringify(mover.json));
    const porEtapa = await esperar("followup-3d", "stage_change", "sent", 60_000);
    check(
      "cambiar de etapa dispara y envía el seguimiento solo",
      porEtapa.length > 0 && porEtapa.some((e) => e.status === "sent"),
      JSON.stringify(porEtapa)
    );
  }

  // El de inactividad no tiene evento: lo barre el programador cada minuto.
  const porSilencio = await esperar("inactivity-e2e", "inactivity", "sent", 120_000);
  check(
    "el barrido de inactividad encola y envía solo",
    porSilencio.length > 0 && porSilencio.some((e) => e.status === "sent"),
    JSON.stringify(porSilencio)
  );

  // Drenar antes de salir: si el lote sigue en la cola, seguirá escribiendo a
  // las conversaciones mientras corre el self-test siguiente.
  const drenaje = Date.now() + 120_000;
  let pendientes = -1;
  while (Date.now() < drenaje) {
    const r = await api(`/api/automations/executions?ruleId=inactivity-e2e&since=${encodeURIComponent(sinceIso)}&limit=200`);
    pendientes = (r.json?.executions ?? []).filter(
      (e) => e.status === "queued" || e.status === "running"
    ).length;
    if (pendientes === 0) break;
    await sleep(1000);
  }
  check("el lote de inactividad queda drenado antes de salir", pendientes === 0, `pendientes=${pendientes}`);

  const desarmar = await api("/api/automations/rules", "POST", { rules: [rule] });
  check("se desarma el barrido de inactividad al terminar", desarmar.response.ok, JSON.stringify(desarmar.json));

  console.log(`AUTOMATIONS: ${checks - failures}/${checks} comprobaciones OK`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
