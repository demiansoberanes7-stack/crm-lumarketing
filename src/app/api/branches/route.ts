import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { createBranch, listBranches } from "@/server/branches/service";

export const dynamic = "force-dynamic";

/** GET — sucursales con sus totales (SKUs y piezas). */
export const GET = withAuth(async (session) => {
  const branches = await listBranches(session.organizationId);
  return Response.json({ branches });
});

const createSchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(255),
  address: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

/** POST — alta de sucursal. */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const { id } = await createBranch(session.organizationId, body.data);
  return Response.json({ ok: true, branch: { id } }, { status: 201 });
});
