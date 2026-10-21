import { apiError, withAuth } from "@/lib/api";
import { whatsappProvider } from "@/server/whatsapp/provider";
import { listWhatsappTemplates } from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

/**
 * Plantillas aprobadas del número conectado. La UI las usa para campañas y
 * envíos programados: fuera de la ventana de 24 h son la única vía legal.
 */
export const GET = withAuth(async (session) => {
  try {
    const provider = await whatsappProvider(session.organizationId);
    const templates = await listWhatsappTemplates(session.organizationId);
    return Response.json({ provider, templates });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudieron leer las plantillas";
    return apiError(422, "template_provider", message);
  }
});
