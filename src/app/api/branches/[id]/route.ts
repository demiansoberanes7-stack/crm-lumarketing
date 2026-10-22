import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { deleteBranch, updateBranch } from "@/server/branches/service";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(255).optional(),
  address: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

/** PATCH — datos de la sucursal. */
export const PATCH = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const result = await updateBranch(session.organizationId, id, body.data);
  if (!result.ok) return apiError(404, result.code, result.message);

  return Response.json({ ok: true });
});

/** DELETE — borra la sucursal y su inventario (cascada). */
export const DELETE = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  const ok = await deleteBranch(session.organizationId, id);
  if (!ok) return apiError(404, "not_found", "Sucursal no encontrada");
  return Response.json({ ok: true });
});
