import { withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { compareTerms } from "@/server/intel/service";

export const dynamic = "force-dynamic";

/** Comparativa de 2–3 nichos: `ids=itr_a,itr_b`. Unidades y ventana iguales. */
export const GET = withAuth(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length < 2 || ids.length > 3) {
    return Response.json(
      {
        error: {
          code: "invalid_ids",
          message: "Selecciona 2 o 3 nichos para comparar",
        },
      },
      { status: 422 }
    );
  }
  const data = await compareTerms(session.organizationId, ids);
  return Response.json(data);
});
