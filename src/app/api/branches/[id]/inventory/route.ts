import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { branchQuantitySchema } from "@/lib/branch-schema";
import {
  getBranch,
  listBranchInventory,
  removeBranchProduct,
  setBranchQuantity,
} from "@/server/branches/service";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

/** GET — inventario de la sucursal, con el stock general de cada producto. */
export const GET = withAuth(async (session, _req, { params }) => {
  const { id } = await params;

  const branch = await getBranch(session.organizationId, id);
  if (!branch) return apiError(404, "not_found", "Sucursal no encontrada");

  const items = await listBranchInventory(session.organizationId, id);
  return Response.json({
    branch: { id: branch.id, name: branch.name },
    items,
  });
});

const putSchema = z.object({
  productId: z.string().min(1).max(255),
  quantity: branchQuantitySchema,
});

/** PUT — enlaza el producto o actualiza su cantidad en la sucursal. */
export const PUT = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const result = await setBranchQuantity(
    session.organizationId,
    id,
    body.data.productId,
    body.data.quantity
  );
  if (!result.ok) return apiError(404, result.code, result.message);

  return Response.json({ ok: true });
});

/** DELETE — quita el producto de la sucursal (?productId=...). */
export const DELETE = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const productId = new URL(req.url).searchParams.get("productId")?.trim() ?? "";
  if (!productId) {
    return apiError(422, "invalid_body", "productId requerido");
  }

  const ok = await removeBranchProduct(session.organizationId, id, productId);
  if (!ok) {
    return apiError(404, "not_found", "Producto no enlazado a la sucursal");
  }
  return Response.json({ ok: true });
});
