import { withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { fetchSuggestions } from "@/server/intel/sources/suggest";

export const dynamic = "force-dynamic";

/**
 * Autocompletado estilo SEMrush para la caja de búsqueda: sugerencias del
 * autocompletado público de Google (YouTube + web, es-MX). Degradación a
 * lista vacía si el servicio externo no responde.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ suggestions: [] });
  const [yt, web] = await Promise.all([
    fetchSuggestions(q, true),
    fetchSuggestions(q, false),
  ]);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const s of [...yt, ...web]) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(s);
    if (merged.length >= 10) break;
  }
  return Response.json({ suggestions: merged });
});
