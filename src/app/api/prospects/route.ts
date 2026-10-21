import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { listProspects } from "@/server/prospects/query";

export const dynamic = "force-dynamic";

/**
 * Prospectos: el filtro va en la URL y la consulta lo aplica ANTES del corte de
 * 200, para que un prospecto buscado no quede fuera por el límite (igual que en
 * /api/contacts).
 */
const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  channel: z.string().trim().max(20).optional(),
  phone: z.enum(["falta", "tiene"]).optional(),
  archived: z.boolean().optional(),
});

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    channel: url.searchParams.get("channel") ?? undefined,
    phone: url.searchParams.get("phone") ?? undefined,
    archived: url.searchParams.get("archived") === "true" ? true : undefined,
  });
  if (!parsed.success) {
    return apiError(422, "invalid_query", "Filtro de prospectos no válido");
  }

  const prospects = await listProspects({
    organizationId: session.organizationId,
    ...parsed.data,
  });
  return Response.json({ prospects });
});
