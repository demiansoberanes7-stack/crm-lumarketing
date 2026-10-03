import type { z } from "zod";
import { getEnv, isAiConfigured, resolveAiToken } from "@/lib/env";

/**
 * Adaptador LLM OpenRouter-compatible — ÚNICA frontera con el proveedor de IA
 * (Constitución II). Regla operativa: la salida del modelo es impredecible;
 * todo consumo pasa por extracción robusta + Zod + reintentos, y un hipo del
 * proveedor jamás propaga excepción (resultado `error` tipado).
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatJsonResult<T> =
  | { ok: true; data: T; raw: string }
  | { ok: false; error: "not_configured" | "provider_error" | "invalid_output"; detail: string };

const MAX_ATTEMPTS = 3;
/**
 * Los límites de los tiers gratuitos (p. ej. Groq: 8000 tokens/min) llegan como
 * HTTP 429 y NO se disuelven en 500 ms: la ventana se vacía poco a poco. Por
 * eso el rate limit tiene su propia bolsa de intentos y esperas largas — un
 * turno que no espera es un turno que escala a mano humana.
 */
const MAX_RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000];
const RETRY_DELAY_MS = 500;

/** Error HTTP del proveedor que conserva status y la espera que pidió. */
class ProviderHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function isRateLimit(err: unknown): boolean {
  return err instanceof ProviderHttpError && err.status === 429;
}

function retryDelayMs(failureIndex: number, err: unknown, rateLimited: boolean): number {
  if (!rateLimited) return RETRY_DELAY_MS * failureIndex;
  const base =
    RATE_LIMIT_BACKOFF_MS[
      Math.min(Math.max(failureIndex - 1, 0), RATE_LIMIT_BACKOFF_MS.length - 1)
    ] ?? RATE_LIMIT_BACKOFF_MS[RATE_LIMIT_BACKOFF_MS.length - 1]!;
  const hinted = err instanceof ProviderHttpError ? err.retryAfterMs : undefined;
  // El hint del proveedor subestima a veces la ventana; se respeta pero con
  // piso (el backoff base) y techo para no colgar un turno más de 45 s.
  return Math.min(Math.max(base, (hinted ?? 0) + 1_000), 45_000);
}

/** `Retry-After` (segundos) o el "try again in Xs" que devuelve Groq. */
function parseRetryAfterMs(res: Response, body: string): number | undefined {
  const header = res.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const match = body.match(/try again in (\d+(?:\.\d+)?)s/i);
  if (match) return Math.ceil(Number(match[1]) * 1000);
  return undefined;
}

/** Resolve AI token+model — env vars only (DB fields are deprecated). */
export async function resolveAiConfig(_organizationId: string) {
  return { token: resolveAiToken(), model: process.env.OPENROUTER_MODEL?.trim() || undefined };
}

export async function chatJson<T>(
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts?: {
    model?: string;
    judge?: boolean;
    timeoutMs?: number;
    organizationId?: string;
    apiKey?: string;
    baseUrl?: string;
  }
): Promise<ChatJsonResult<T>> {
  // Resolve env-var config
  let dbToken: string | undefined;
  if (opts?.organizationId && !opts?.apiKey) {
    const cfg = await resolveAiConfig(opts.organizationId);
    dbToken = cfg.token;
  }

  const token = opts?.apiKey || undefined;
  if (!isAiConfigured(token ?? dbToken)) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin OPENROUTER_API_TOKEN configurado",
    };
  }
  const env = getEnv();
  const model =
    opts?.model ??
    (opts?.judge
      ? (env.OPENROUTER_JUDGE_MODEL ?? env.OPENROUTER_MODEL)
      : env.OPENROUTER_MODEL);
  if (!model?.trim()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin OPENROUTER_MODEL configurado",
    };
  }

  let lastDetail = "";
  let rateLimited = false;
  let attempt = 1;
  while (attempt <= MAX_RATE_LIMIT_ATTEMPTS) {
    const limit = rateLimited ? MAX_RATE_LIMIT_ATTEMPTS : MAX_ATTEMPTS;
    if (attempt > limit) break;

    const attemptMessages: ChatMessage[] =
      attempt === 1
        ? messages
        : [
            ...messages,
            {
              role: "system",
              content:
                "STRICT: tu respuesta anterior no fue JSON válido según el esquema. Responde ÚNICAMENTE el objeto JSON, sin explicaciones ni markdown.",
            },
          ];
    attempt += 1;
    try {
      const raw = await callProvider(model, attemptMessages, opts?.timeoutMs, token ?? dbToken, opts?.baseUrl);
      const extracted = extractJson(raw);
      if (extracted === null) {
        lastDetail = `sin JSON extraíble (raw=${truncate(raw)})`;
        continue;
      }
      const parsed = schema.safeParse(extracted);
      if (!parsed.success) {
        lastDetail = `no cumple el esquema: ${parsed.error.issues
          .map((i) => i.path.join(".") + " " + i.message)
          .join("; ")} (raw=${truncate(raw)})`;
        continue;
      }
      return { ok: true, data: parsed.data, raw };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      rateLimited = isRateLimit(err);
      const failures = attempt - 1;
      const nextLimit = rateLimited ? MAX_RATE_LIMIT_ATTEMPTS : MAX_ATTEMPTS;
      if (failures < nextLimit) {
        await sleep(retryDelayMs(failures, err, rateLimited));
      }
    }
  }

  return {
    ok: false,
    error: lastDetail.includes("esquema") || lastDetail.includes("JSON")
      ? "invalid_output"
      : "provider_error",
    detail: lastDetail,
  };
}

async function callProvider(
  model: string,
  messages: ChatMessage[],
  timeoutMs = 60_000,
  explicitToken?: string,
  customBaseUrl?: string
): Promise<string> {
  const env = getEnv();
  // Explicit per-call token takes priority; env var is fallback only
  const token = explicitToken?.trim() || resolveAiToken();
  const baseUrl = customBaseUrl?.replace(/\/+$/, "") || env.OPENROUTER_BASE_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        // El token jamás se loguea; solo viaja en este header.
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const providerMessage = text || res.statusText || "sin detalle";
      console.error("[LLM] HTTP error", { status: res.status, body: providerMessage });
      throw new ProviderHttpError(
        res.status,
        `El proveedor de IA respondió HTTP ${res.status}: ${truncate(providerMessage, 1000)}`,
        parseRetryAfterMs(res, providerMessage)
      );
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("respuesta del proveedor sin contenido");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracción robusta de JSON de una respuesta de modelo:
 * 1) bloque ```json ... ``` (o ``` ... ```), 2) el texto completo,
 * 3) del primer `{` al último `}`.
 */
export function extractJson(raw: string): unknown | null {
  const candidates: string[] = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(raw.trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(raw.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
