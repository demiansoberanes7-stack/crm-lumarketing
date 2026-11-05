import { apiError, withAuth } from "@/lib/api";
import { deleteProductImage } from "@/server/catalog/images";

export const dynamic = "force-dynamic";

/**
 * Borra una foto: `/api/catalog/images/[imageId]`.
 *
 * La id del archivo manda, no la del producto: desde la tira del modal se
 * borra «esta foto», y el producto ya se sabe por la fila. El `scoped()` del
 * servicio es lo que impide que una id de otro negocio borre nada.
 */
type _Params = { params: Promise<{ imageId: string }> };

export const DELETE = withAuth(async (session, _req: Request, { params }: _Params) => {
  const { imageId } = await params;
  const result = await deleteProductImage(session.organizationId, imageId);
  if (!result.ok) return apiError(404, result.code, result.message);
  return Response.json({ ok: true });
});
