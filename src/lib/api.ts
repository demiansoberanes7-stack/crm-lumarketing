import { z } from "zod";
import { requireSession, UnauthorizedError, type SessionContext } from "@/lib/auth/session";
import { recordDiagnostic } from "@/server/diagnostics/logger";

/** Respuesta de error estándar de la API interna (contrato api.md). */
export function apiError(
  status: number,
  code: string,
  message: string
): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Envuelve un route handler autenticado: resuelve la sesión (401 si no hay),
 * captura errores no controlados (500 sin stack) y deja pasar Response.
 */
export function withAuth<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let session: SessionContext;
    try {
      session = await requireSession();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return apiError(401, "unauthorized", "No autenticado");
      }
      throw err;
    }
    try {
      return await handler(session, ...args);
    } catch (err) {
      await recordDiagnostic({ organizationId: session.organizationId, source: "api", code: "api_failed", error: err });
      return apiError(500, "internal", "Error interno");
    }
  };
}

export function withOwner<Args extends unknown[]>(handler: (session: SessionContext, ...args: Args) => Promise<Response>) {
  return withAuth<Args>(async (session, ...args) => {
    if (session.role !== "owner") return apiError(403, "forbidden", "Sólo el propietario puede administrar esta configuración");
    return handler(session, ...args);
  });
}

/** Parsea el body JSON con un esquema Zod; inválido → Response 422. */
export async function parseBody<T>(
  req: Request,
  // `Input = unknown` a propósito: con `Input = T` (el default) TypeScript
  // infiere T como la UNIÓN de entrada y salida, y un campo con `.default()`
  // salía como opcional aunque tras parsear siempre existe.
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: apiError(422, "invalid_body", "El body debe ser JSON válido"),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      response: apiError(422, "invalid_body", detail),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Entero de un query param, siempre acotado.
 *
 * Existe porque varias rutas hacían `parseInt(url.searchParams.get("limit") ??
 * "50")` y se quedaban sin respaldo: `?limit=abc` produce `NaN`, Drizzle lo
 * manda como `LIMIT NaN`, Postgres rechaza la consulta y la ruta responde 500 —
 * que las pantallas leían como «no hay datos». Ausente, vacío o basura vuelven
 * al respaldo; lo negativo o desbordado se acota al rango permitido.
 */
export function intParam(
  url: URL,
  name: string,
  { fallback, min = 0, max }: { fallback: number; min?: number; max?: number }
): number {
  const raw = url.searchParams.get(name);
  const parsed = raw === null || raw.trim() === "" ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  const floored = Math.max(parsed, min);
  return max === undefined ? floored : Math.min(floored, max);
}
