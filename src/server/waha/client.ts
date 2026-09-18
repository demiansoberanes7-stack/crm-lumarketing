/**
 * WAHA API client — cliente HTTP para WhatsApp HTTP API.
 *
 * WAHA corre en un servidor propio con HTTPS. El CRM le habla por REST.
 * Documentación: https://waha.devlike.pro/docs/
 */
import { validateWahaUrl } from "./url";

export type WahaSessionStatus =
  | "STARTING"
  | "SCAN_QR_CODE"
  | "WORKING"
  | "PASSKEY_REQUIRED"
  | "PASSKEY_CONFIRMATION_REQUIRED"
  | "FAILED"
  | "STOPPED";

export type WahaMessageAck = -1 | 0 | 1 | 2 | 3 | 4;

export class WahaError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = "WahaError";
  }
}

/**
 * Realiza una petición a la API de WAHA.
 * Traduce fallos a errores seguros, sin cuerpos remotos ni credenciales.
 */
export async function wahaRequest(
  baseUrl: string,
  apiKey: string,
  path: string,
  opts?: { method?: string; body?: unknown; binary?: boolean }
): Promise<unknown> {
  await validateWahaUrl(baseUrl);
  const url = new URL(path, baseUrl);
  if (url.origin !== new URL(baseUrl).origin) throw new WahaError("Origen WAHA inválido");
  try {
    const res = await fetch(url, {
      method: opts?.method ?? "GET",
      signal: AbortSignal.timeout(20000),
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        Accept: opts?.binary ? "image/png" : "application/json",
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      throw new WahaError(
        res.status === 401 || res.status === 403 ? "WAHA rechazó la API key o sus permisos" : `WAHA respondió HTTP ${res.status}`,
        res.status
      );
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (opts?.binary && contentType.includes("image/png")) return Buffer.from(await res.arrayBuffer());
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return res.text();
  } catch (err) {
    if (err instanceof WahaError) throw err;
    throw new WahaError("No se pudo conectar a WAHA o la solicitud excedió 20 segundos");
  }
}

/** Verificar estado de la sesión */
export async function getSessionStatus(
  baseUrl: string,
  apiKey: string,
  sessionName: string
): Promise<{ status: WahaSessionStatus; qr?: string }> {
  const data = (await wahaRequest(
    baseUrl,
    apiKey,
    `/api/sessions/${encodeURIComponent(sessionName)}`
  )) as Record<string, unknown>;
  return {
    status: (data.status as WahaSessionStatus) ?? "STOPPED",
    qr: data.qr as string | undefined,
  };
}

/** Iniciar sesión */
export async function startSession(
  baseUrl: string,
  apiKey: string,
  sessionName: string
): Promise<void> {
  await wahaRequest(baseUrl, apiKey, `/api/sessions/${encodeURIComponent(sessionName)}/start`, {
    method: "POST",
  });
}

/** Detener sesión */
export async function stopSession(
  baseUrl: string,
  apiKey: string,
  sessionName: string
): Promise<void> {
  await wahaRequest(baseUrl, apiKey, `/api/sessions/${encodeURIComponent(sessionName)}/stop`, {
    method: "POST",
  });
}

/** Enviar mensaje de texto */
export async function sendText(
  baseUrl: string,
  apiKey: string,
  sessionName: string,
  chatId: string,
  text: string
): Promise<{ key: { id: string } }> {
  const result = (await wahaRequest(
    baseUrl,
    apiKey,
    `/api/sendText`,
    {
      method: "POST",
      body: { session: sessionName, chatId, text },
    }
  )) as { id?: string; key?: { id: string } };
  const id = result.id ?? result.key?.id;
  if (!id) throw new WahaError("WAHA no confirmó el mensaje");
  return { key: { id } };
}

/** Enviar archivo */
export async function sendFile(
  baseUrl: string,
  apiKey: string,
  sessionName: string,
  chatId: string,
  file: { mimetype: string; url?: string; path?: string; caption?: string; data?: string; filename?: string }
): Promise<{ key: { id: string } }> {
  const result = (await wahaRequest(
    baseUrl,
    apiKey,
    file.mimetype.startsWith("image/") ? "/api/sendImage" : file.mimetype.startsWith("video/") ? "/api/sendVideo" : file.mimetype.startsWith("audio/") ? "/api/sendVoice" : "/api/sendFile",
    {
      method: "POST",
      body: { session: sessionName, chatId, file, caption: file.caption, ...(file.mimetype.startsWith("audio/") ? { convert: true } : {}) },
    }
  )) as { id?: string; key?: { id: string } };
  const id = result.id ?? result.key?.id;
  if (!id) throw new WahaError("WAHA no confirmó el archivo");
  return { key: { id } };
}

/** Marcar como leído */
export async function markSeen(
  baseUrl: string,
  apiKey: string,
  sessionName: string,
  chatId: string
): Promise<void> {
  await wahaRequest(baseUrl, apiKey, "/api/sendSeen", {
    method: "POST",
    body: { session: sessionName, chatId },
  });
}

/** Mostrar "escribiendo…" */
export async function typing(
  baseUrl: string,
  apiKey: string,
  sessionName: string,
  chatId: string
): Promise<void> {
  await wahaRequest(baseUrl, apiKey, "/api/startTyping", {
    method: "POST",
    body: { session: sessionName, chatId },
  });
}

/** Detener "escribiendo…" */
export async function clearTyping(
  baseUrl: string,
  apiKey: string,
  sessionName: string,
  chatId: string
): Promise<void> {
  await wahaRequest(baseUrl, apiKey, "/api/stopTyping", {
    method: "POST",
    body: { session: sessionName, chatId },
  });
}

/** Enviar plantilla (out-of-window) */
export async function sendTemplate(
  baseUrl: string,
  apiKey: string,
  sessionName: string,
  chatId: string,
  template: { name: string; language: { code: string }; components?: unknown[] }
): Promise<{ key: { id: string } }> {
  const result = (await wahaRequest(
    baseUrl,
    apiKey,
    `/api/${sessionName}/sendTemplate`,
    {
      method: "POST",
      body: { chatId, template },
    }
  )) as { id?: string; key?: { id: string } };
  const id = result.id ?? result.key?.id;
  if (!id) throw new WahaError("WAHA no confirmó la plantilla");
  return { key: { id } };
}

/** Obtener QR code */
export async function getQR(
  baseUrl: string,
  apiKey: string,
  sessionName: string
): Promise<string | null> {
  const data = (await wahaRequest(
    baseUrl,
    apiKey,
    `/api/${encodeURIComponent(sessionName)}/auth/qr?format=image`,
    { binary: true }
  ));
  if (Buffer.isBuffer(data)) return `data:image/png;base64,${data.toString("base64")}`;
  const json = data as { data?: string };
  return typeof json?.data === "string" && /^[A-Za-z0-9+/=]+$/.test(json.data) ? `data:image/png;base64,${json.data}` : null;
}
