import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  addProductImage,
  listProductImages,
  reorderProductImages,
  setPrimaryProductImage,
} from "@/server/catalog/images";
import { normalizeAltText } from "@/lib/product-images";

export const dynamic = "force-dynamic";

/**
 * Fotos de un producto.
 *
 * `GET` sirve la tira con su URL pública; `POST` sube (multipart, porque el
 * archivo viene del disco del usuario); `PATCH` reordena y cambia la principal.
 * Borrar tiene su propia ruta (`/api/catalog/images/[imageId]`) porque la id va
 * en la URL y el producto no se repite en el cuerpo.
 */

type _Params = { params: Promise<{ id: string }> };

/** GET — la tira en su orden visible */
export const GET = withAuth(async (session, _req: Request, { params }: _Params) => {
  const { id } = await params;
  return Response.json({ images: await listProductImages(session.organizationId, id) });
});

/** POST — subir una foto (multipart) */
export const POST = withAuth(async (session, req: Request, { params }: _Params) => {
  const { id } = await params;
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return apiError(422, "invalid_type", "Se esperaba multipart/form-data");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    // Cuerpo cortado o mayor de lo que el runtime admite: se dice, no se deja
    // que `withAuth` responda un 500 sin explicación.
    return apiError(422, "invalid_body", "No se pudo leer el archivo subido.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return apiError(422, "missing_file", "Falta el archivo.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await addProductImage({
    organizationId: session.organizationId,
    productId: id,
    userId: session.userId,
    bytes,
    altText: normalizeAltText(form.get("altText") as string | null | undefined),
  });

  if (!result.ok) {
    return apiError(result.code === "not_found" ? 404 : 422, result.code, result.message);
  }
  return Response.json({ ok: true, image: result.image }, { status: 201 });
});

const patchSchema = z
  .object({
    // `.min(1)`: sin esta cota, `{primaryId: ""}` pasaba el filtro de abajo y
    // la ruta respondía 200 habiendo hecho nada.
    primaryId: z.string().min(1).max(255).optional(),
    orderedIds: z.array(z.string().min(1).max(255)).min(1).max(30).optional(),
  })
  .refine((body) => body.primaryId !== undefined || body.orderedIds !== undefined, {
    message: "Nada que actualizar",
  });

/** PATCH — marcar principal y/o reordenar */
export const PATCH = withAuth(async (session, req: Request, { params }: _Params) => {
  const { id } = await params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  if (body.data.orderedIds) {
    await reorderProductImages(session.organizationId, id, body.data.orderedIds);
  }
  if (body.data.primaryId) {
    const result = await setPrimaryProductImage(session.organizationId, body.data.primaryId);
    if (!result.ok) {
      return apiError(404, result.code, "La imagen elegida no es de este producto.");
    }
  }
  return Response.json({ ok: true, images: await listProductImages(session.organizationId, id) });
});
