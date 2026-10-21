import { withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { getContentInsights } from "@/server/intel/content";

export const dynamic = "force-dynamic";

/**
 * Contenidos que funcionan (Grupo D): agregados de la muestra de videos
 * capturados (duración, patrón de título, engagement, top videos).
 * Unidades y sesgo (mostPopular MX) documentados en el panel de UI.
 *
 * `q` opcional: acota la muestra a los videos que hablan de ESA consulta, para
 * que el panel se relate con la búsqueda en vez de desaparecer cuando hay una.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days") ?? "30");
  const windowDays =
    Number.isFinite(daysParam) && daysParam >= 7 && daysParam <= 90
      ? Math.round(daysParam)
      : 30;
  const insights = await getContentInsights(
    session.organizationId,
    windowDays,
    url.searchParams.get("q")
  );
  return Response.json(insights);
});
