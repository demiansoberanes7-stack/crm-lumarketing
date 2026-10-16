import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { getAiDbToken, verifyAiToken } from "@/server/ai/credentials";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ token: z.string().trim().min(1).max(512) }).strict();

/**
 * Prueba en vivo de la clave LLM contra `GET {base}/v1/models`. Si el body
 * trae un token enmascarado ("····"), usa la guardada en BD (o, si no hay,
 * la variable de entorno); si trae una clave nueva, la prueba directamente.
 */
export const POST = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  let token = body.data.token;
  if (token.startsWith("····")) {
    const saved = await getAiDbToken(session.organizationId);
    token = saved ?? process.env.OPENROUTER_API_TOKEN?.trim() ?? "";
    if (!token) {
      return apiError(422, "ai_not_saved", "Guarda la clave antes de probar la conexión.");
    }
  }

  const result = await verifyAiToken(token);
  if (!result.ok) {
    return apiError(422, "ai_test_failed", result.reason ?? "El proveedor rechazó la clave.");
  }
  return Response.json({ ok: true });
});
