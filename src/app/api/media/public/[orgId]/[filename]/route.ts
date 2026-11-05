import { publicMediaResponse } from "@/server/media-path";

export const dynamic = "force-dynamic";

/**
 * Logo del negocio: `/api/media/public/[orgId]/[archivo]`.
 *
 * Forma histórica — es la URL que ya está escrita en `organization.metadata`—
 * y por eso sigue existiendo aparte de la catch-all. Ambas delegan en el mismo
 * `publicMediaResponse()`, así que el tipo de archivo y el permiso público se
 * deciden una sola vez.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; filename: string }> }
) {
  const { orgId, filename } = await params;
  return publicMediaResponse(orgId, [filename]);
}
