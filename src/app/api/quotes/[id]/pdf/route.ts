import { apiError, withAuth } from "@/lib/api";
import { quotePdf } from "@/server/quotes/pdf";
import { pdfResponse } from "@/server/documents/pdf";
export const GET = withAuth(async (session, req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const pdf = await quotePdf(session.organizationId, (await params).id);
  if (!pdf) return apiError(404, "not_found", "Cotización no encontrada");
  return pdfResponse(pdf.bytes, pdf.filename, new URL(req.url).searchParams.get("download") === "1");
});
