/**
 * WAHA API client — cliente HTTP para WhatsApp HTTP API.
 *
 * WAHA corre en un servidor propio con HTTPS. El CRM le habla por REST.
 * Documentación: https://waha.devlike.pro/docs/
 */


export type WahaSessionStatus =
  | "STARTING"
  | "SCAN_QR_CODE"
  | "WORKING"
  | "FAILED"
  | "STOPPED";

export type WahaMessageAck = 0 | 1 | 2 | 3 | 4 | 5;

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
 * No lanza errores de red hacia afuera — los captura y retorna null.
 */
export async function wahaRequest(
  baseUrl: string,
  apiKey: string,
  path: string,
  opts?: { method?: string; body?: unknown }
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  try {
    const res = await fetch(url, {
      method: opts?.method ?? "GET",
      signal: AbortSignal.timeout(20000),
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new WahaError(
        `WAHA ${opts?.method ?? "GET"} ${path} → ${res.status}: ${text}`,
        res.status
      );
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return res.text();
  } catch (err) {
    if (err instanceof WahaError) throw err;
    throw new WahaError(`WAHA request failed: ${String(err)}`);
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
    `/api/sendFile`,
    {
      method: "POST",
      body: { session: sessionName, chatId, file, caption: file.caption },
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
  await wahaRequest(baseUrl, apiKey, `/api/${encodeURIComponent(sessionName)}/markSeen`, {
    method: "POST",
    body: { chatId },
  });
}

/** Mostrar "escribiendo…" */
export async function typing(
  baseUrl: string,
  apiKey: string,
  sessionName: string,
  chatId: string
): Promise<void> {
  await wahaRequest(baseUrl, apiKey, `/api/${encodeURIComponent(sessionName)}/typing`, {
    method: "POST",
    body: { chatId, interval: 5000 },
  });
}

/** Detener "escribiendo…" */
export async function clearTyping(
  baseUrl: string,
  apiKey: string,
  sessionName: string,
  chatId: string
): Promise<void> {
  await wahaRequest(baseUrl, apiKey, `/api/${encodeURIComponent(sessionName)}/clearTyping`, {
    method: "POST",
    body: { chatId },
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
    `/api/${encodeURIComponent(sessionName)}/auth/qr?format=image`
  )) as Record<string, unknown>;
  return typeof data.data === "string" ? `data:image/png;base64,${data.data}` : (data.qr as string) ?? null;
}
