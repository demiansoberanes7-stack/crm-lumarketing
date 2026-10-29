import { MetaApiError } from "@/lib/meta/client";
import { zernioFetch } from "@/server/zernio";

/**
 * 017 — Alta, diagnóstico y reparación del webhook de Zernio.
 *
 * El CRM solo recibe si Zernio tiene registrada ESTA instalación. Cuando cambia
 * el host (una migración, un dominio nuevo) o rota el token del segmento de la
 * URL, el endpoint se queda apuntando al anterior y las entregas fallan sin
 * dejar rastro en la base: no llega nada, así que no hay fila que investigar y
 * el webhook parece «configurado». Con la llave que ya está guardada, la API de
 * Zernio permite leer y corregir esa configuración, y probarla en el acto.
 *
 * Una sola suscripción sirve a todas las organizaciones de esta instancia: la
 * URL lleva el segmento secreto de la instancia y el reparto a cada negocio lo
 * hace `account.id` (ver `dispatch.ts`).
 */

/** Rutas de esta app que aceptan eventos de Zernio. */
const CRM_WEBHOOK_PATH_PREFIXES = ["/api/webhooks/messenger/", "/api/webhooks/ig/"];

/** Eventos que el CRM procesa hoy. Suscribirse a más solo genera ruido. */
export const ZERNIO_REQUIRED_EVENTS = ["message.received", "comment.received"] as const;

export type ZernioWebhook = {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  failureCount: number;
  lastFiredAt: string | null;
};

export type ZernioWebhookLog = {
  webhookId: string | null;
  event: string | null;
  test: boolean;
  status: "success" | "failed" | null;
  statusCode: number | null;
  errorMessage: string | null;
  attemptNumber: number | null;
  responseTime: number | null;
  createdAt: string | null;
};

export type DeliveryTest = {
  ok: boolean;
  statusCode: number | null;
  errorMessage: string | null;
  responseTime: number | null;
  at: string | null;
};

export type DeliveryState =
  | "missing"
  | "wrong_url"
  | "inactive"
  | "ok";

export type DeliveryInspection = {
  expectedUrl: string;
  state: DeliveryState;
  endpoint: ZernioWebhook | null;
  /** Última entrega real de un mensaje entrante, si hay. */
  lastInbound: ZernioWebhookLog | null;
  recent: ZernioWebhookLog[];
};

/* ------------------------------- lectura -------------------------------- */

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** El `secret` del endpoint NUNCA se proyecta fuera de este módulo. */
function asWebhook(raw: unknown): ZernioWebhook | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r._id) ?? str(r.id);
  const url = str(r.url);
  if (!id || !url) return null;
  return {
    id,
    name: str(r.name) ?? "",
    url,
    events: Array.isArray(r.events)
      ? r.events.filter((e): e is string => typeof e === "string")
      : [],
    isActive: r.isActive !== false,
    failureCount: num(r.failureCount) ?? 0,
    lastFiredAt: str(r.lastFiredAt),
  };
}

function asLog(raw: unknown): ZernioWebhookLog | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const status = r.status === "success" || r.status === "failed" ? r.status : null;
  return {
    webhookId: str(r.webhookId),
    event: str(r.event),
    test: r.test === true,
    status,
    statusCode: num(r.statusCode),
    errorMessage: str(r.errorMessage),
    attemptNumber: num(r.attemptNumber),
    responseTime: num(r.responseTime),
    createdAt: str(r.createdAt),
  };
}

export function sameWebhookUrl(a: string, b: string): boolean {
  try {
    return new URL(a.trim()).href === new URL(b.trim()).href;
  } catch {
    return a.trim() === b.trim();
  }
}

/** ¿La URL apunta a una ruta de esta app? (así se reconoce un endpoint viejo). */
export function isCrmWebhookUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return CRM_WEBHOOK_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

/**
 * Qué endpoint hay que corregir: el que ya apunta al destino exacto si existe,
 * y si no el primero que apunta a una ruta del CRM (host o token viejos). Un
 * endpoint ajeno —otro producto, otro despliegue con otra ruta— no se toca.
 */
export function pickWebhookToRepair(
  webhooks: ZernioWebhook[],
  expectedUrl: string
): ZernioWebhook | null {
  const exact = webhooks.find((w) => sameWebhookUrl(w.url, expectedUrl));
  if (exact) return exact;
  return webhooks.find((w) => isCrmWebhookUrl(w.url)) ?? null;
}

/** Une sin pisar lo que el dueño ya tenía suscrito. */
export function mergeEvents(existing: string[], required: readonly string[]): string[] {
  return Array.from(new Set([...existing, ...required]));
}

export function deliveryState(
  endpoint: ZernioWebhook | null,
  expectedUrl: string
): DeliveryState {
  if (!endpoint) return "missing";
  if (!sameWebhookUrl(endpoint.url, expectedUrl)) return "wrong_url";
  if (!endpoint.isActive) return "inactive";
  return "ok";
}

/* ------------------------------- llamadas -------------------------------- */

export async function listZernioWebhooks(token: string): Promise<ZernioWebhook[]> {
  const res = (await zernioFetch("/webhooks/settings", { token })) as {
    webhooks?: unknown;
  } | null;
  // Una lista que no viene NO es una lista vacía: leerla como «no hay nada»
  // haría que la reparación creara un segundo endpoint y cada mensaje llegara
  // dos veces.
  if (!Array.isArray(res?.webhooks)) {
    throw new MetaApiError("Zernio no devolvió la lista de webhooks", { status: 502 });
  }
  return res.webhooks
    .map(asWebhook)
    .filter((w): w is ZernioWebhook => w !== null);
}

export async function listZernioWebhookLogs(
  token: string,
  opts: { webhookId?: string; event?: string; limit?: number } = {}
): Promise<ZernioWebhookLog[]> {
  const params = new URLSearchParams();
  if (opts.webhookId) params.set("webhookId", opts.webhookId);
  if (opts.event) params.set("event", opts.event);
  params.set("limit", String(Math.min(Math.max(opts.limit ?? 10, 1), 50)));
  const res = (await zernioFetch(`/webhooks/logs?${params.toString()}`, {
    token,
  })) as { logs?: unknown } | null;
  if (!Array.isArray(res?.logs)) return [];
  return res.logs.map(asLog).filter((l): l is ZernioWebhookLog => l !== null);
}

export async function createZernioWebhook(
  token: string,
  input: { name: string; url: string; events: string[]; secret: string | null }
): Promise<ZernioWebhook> {
  const res = (await zernioFetch("/webhooks/settings", {
    method: "POST",
    token,
    body: {
      name: input.name,
      url: input.url,
      events: input.events,
      ...(input.secret ? { secret: input.secret } : {}),
    },
  })) as { webhook?: unknown } | null;
  const created = asWebhook(res?.webhook);
  if (!created) {
    throw new MetaApiError("Zernio no devolvió el endpoint creado", { status: 502 });
  }
  return created;
}

export async function updateZernioWebhook(
  token: string,
  input: {
    webhookId: string;
    url: string;
    events: string[];
    isActive: boolean;
    secret: string | null;
  }
): Promise<ZernioWebhook> {
  const res = (await zernioFetch("/webhooks/settings", {
    method: "PUT",
    token,
    body: {
      webhookId: input.webhookId,
      url: input.url,
      events: input.events,
      isActive: input.isActive,
      ...(input.secret ? { secret: input.secret } : {}),
    },
  })) as { webhook?: unknown } | null;
  const updated = asWebhook(res?.webhook);
  if (!updated) {
    throw new MetaApiError("Zernio no devolvió el endpoint actualizado", { status: 502 });
  }
  return updated;
}

/**
 * Entrega de prueba: la manda Zernio a la URL registrada, sin reintentos, y
 * responde error si el endpoint no contestó 2xx. Es la única forma de probar
 * el camino completo (DNS, TLS, segmento de la URL, guards) sin esperar a que
 * una persona real escriba.
 */
export async function sendZernioTestDelivery(token: string, webhookId: string): Promise<void> {
  await zernioFetch("/webhooks/test", {
    method: "POST",
    token,
    body: { webhookId },
  });
}

/* ------------------------------ operaciones ------------------------------ */

export async function inspectZernioDelivery(input: {
  token: string;
  expectedUrl: string;
}): Promise<DeliveryInspection> {
  const webhooks = await listZernioWebhooks(input.token);
  const endpoint = pickWebhookToRepair(webhooks, input.expectedUrl);
  const recent = endpoint
    ? await listZernioWebhookLogs(input.token, { webhookId: endpoint.id, limit: 10 })
    : [];
  return {
    expectedUrl: input.expectedUrl,
    state: deliveryState(endpoint, input.expectedUrl),
    endpoint,
    lastInbound: recent.find((l) => l.event === "message.received") ?? null,
    recent,
  };
}

export type RepairResult = {
  action: "created" | "updated";
  endpoint: ZernioWebhook;
  /** URL que tenía el endpoint antes de corregirlo, si era otro destino. */
  previousUrl: string | null;
  fixed: Array<"url" | "isActive" | "events">;
  test: DeliveryTest;
};

/**
 * Deja el webhook de esta instancia registrado y apuntando al destino correcto,
 * y lo prueba. No borra ni desactiva nada ajeno: solo actúa sobre el endpoint
 * que ya usa una ruta del CRM o sobre uno nuevo.
 */
export async function repairZernioDelivery(input: {
  token: string;
  expectedUrl: string;
  secret: string | null;
  name: string;
  events?: readonly string[];
}): Promise<RepairResult> {
  const required = input.events ?? ZERNIO_REQUIRED_EVENTS;
  const webhooks = await listZernioWebhooks(input.token);
  const existing = pickWebhookToRepair(webhooks, input.expectedUrl);

  let endpoint: ZernioWebhook;
  let action: RepairResult["action"];
  let previousUrl: string | null = null;
  let fixed: RepairResult["fixed"] = [];

  if (existing) {
    const urlOk = sameWebhookUrl(existing.url, input.expectedUrl);
    const events = mergeEvents(existing.events, required);
    const eventsOk = required.every((e) => existing.events.includes(e));
    fixed = [
      ...(urlOk ? [] : (["url"] as const)),
      ...(existing.isActive ? [] : (["isActive"] as const)),
      ...(eventsOk ? [] : (["events"] as const)),
    ];
    previousUrl = urlOk ? null : existing.url;
    endpoint = await updateZernioWebhook(input.token, {
      webhookId: existing.id,
      url: input.expectedUrl,
      events,
      isActive: true,
      secret: input.secret,
    });
    action = "updated";
  } else {
    endpoint = await createZernioWebhook(input.token, {
      name: input.name,
      url: input.expectedUrl,
      events: [...required],
      secret: input.secret,
    });
    action = "created";
  }

  const test = await runTestDelivery(input.token, endpoint.id);
  return { action, endpoint, previousUrl, fixed, test };
}

/**
 * El test contesta 500 cuando el endpoint no devolvió 2xx, y el detalle útil
 * (código y cuerpo de la respuesta) está en los logs: se leen igual, porque un
 * test fallido es la información que más se necesita.
 */
async function runTestDelivery(token: string, webhookId: string): Promise<DeliveryTest> {
  let failure: string | null = null;
  try {
    await sendZernioTestDelivery(token, webhookId);
  } catch (err) {
    failure = err instanceof Error ? err.message : "La prueba de entrega falló";
  }

  const logs = await listZernioWebhookLogs(token, { webhookId, limit: 5 }).catch(
    () => [] as ZernioWebhookLog[]
  );
  const entry = logs.find((l) => l.test || l.event === "webhook.test") ?? null;

  return {
    ok: failure === null && (entry?.status ?? "success") === "success",
    statusCode: entry?.statusCode ?? null,
    errorMessage: entry?.errorMessage ?? failure,
    responseTime: entry?.responseTime ?? null,
    at: entry?.createdAt ?? null,
  };
}
