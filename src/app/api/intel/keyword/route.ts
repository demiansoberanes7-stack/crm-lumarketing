import { withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { analyzeKeyword } from "@/server/intel/keyword";

export const dynamic = "force-dynamic";

/**
 * Analizador de palabras clave estilo SEMrush: intención, dificultad proxy,
 * relacionadas y preguntas (autocompletado), SERP real de YouTube e historial
 * medido si coincide con el catálogo. Fuentes 100% gratuitas.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return Response.json(
      { error: { code: "invalid_query", message: "Escribe una palabra clave (mín. 2 caracteres)" } },
      { status: 422 }
    );
  }
  const overview = await analyzeKeyword(session.organizationId, q);
  return Response.json(overview);
});
