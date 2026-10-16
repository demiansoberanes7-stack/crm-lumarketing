import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { clearAiToken, getAiCredentialSummary, saveAiToken } from "@/server/ai/credentials";

export const dynamic = "force-dynamic";

/**
 * Clave LLM compartida del agente y del copiloto (solo owner). El secreto
 * jamás se devuelve completo: solo `configured`, `source` (db/env) y last4.
 */
export const GET = withOwner(async (session) => {
  return Response.json({ ai: await getAiCredentialSummary(session.organizationId) });
});

const putSchema = z.object({ token: z.string().trim().max(512) }).strict();

/**
 * PUT: guarda o reemplaza la clave (cifrada en BD). Un token vacío o
 * enmascarado ("····") conserva la guardada — misma semántica que INTEL.
 */
export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const raw = body.data.token;
  if (!raw || raw.startsWith("····")) {
    return Response.json({ ai: await getAiCredentialSummary(session.organizationId), saved: false });
  }
  if (raw.length < 8) {
    return apiError(422, "token_too_short", "La clave debe tener al menos 8 caracteres.");
  }
  const saved = await saveAiToken(session.organizationId, raw);
  if (!saved) return apiError(404, "not_found", "Perfil del agente no encontrado");
  return Response.json({ ai: await getAiCredentialSummary(session.organizationId), saved: true });
});

/** DELETE: quita la clave guardada (vuelve al respaldo de la variable de entorno). */
export const DELETE = withOwner(async (session) => {
  await clearAiToken(session.organizationId);
  return Response.json({ ai: await getAiCredentialSummary(session.organizationId) });
});
