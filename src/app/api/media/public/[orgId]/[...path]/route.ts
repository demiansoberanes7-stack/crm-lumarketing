import { publicMediaResponse } from "@/server/media-path";

export const dynamic = "force-dynamic";

/**
 * Media pública con cualquier profundidad: `/api/media/public/[orgId]/catalog/[archivo]`.
 *
 * Qué se sirve y qué no lo decide `publicMediaResponse()` en
 * `src/server/media-path.ts`, que es la única implementación de esta superficie.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; path: string[] }> }
) {
  const { orgId, path } = await params;
  return publicMediaResponse(orgId, path);
}
