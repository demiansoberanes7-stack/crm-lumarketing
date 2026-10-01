import { apiError, withAuth } from "@/lib/api";
import { projectPdf } from "@/server/projects/pdf";
import { pdfResponse } from "@/server/documents/pdf";

export const dynamic = "force-dynamic";

/** GET — PDF del expediente (?download=1 para descarga) */
export const GET = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const pdf = await projectPdf(session.organizationId, id);
  if (!pdf) return apiError(404, "not_found", "Proyecto no encontrado");
  const download = new URL(req.url).searchParams.get("download") === "1";
  return pdfResponse(pdf.bytes, pdf.filename, download);
});
