import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getSessionOrNull } from "@/lib/auth/session";
import { isValidHex, resolveAccentSet } from "@/lib/branding";
import { CURRENCIES } from "@/lib/money";
import { getBranding, saveBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

/** GET público: el login necesita la marca antes de autenticarse. */
export async function GET() {
  const session = await getSessionOrNull();
  const branding = await getBranding(session?.organizationId);
  return Response.json({ branding, accentSet: resolveAccentSet(branding.accent) });
}

const putSchema = z.object({
  /** Opcional: el nombre visible vive en Datos de Empresa, no en este panel. */
  name: z.string().trim().min(1).max(30).optional(),
  accent: z.string().refine(isValidHex, "Color hex inválido (#rrggbb)"),
  /** La moneda del negocio: la única que el tablero suma. */
  currency: z.enum(CURRENCIES),
  /** Colores de los PDF; opcional para no romper clientes viejos. */
  pdfColors: z
    .object({
      header: z.string().refine(isValidHex, "Color hex inválido (#rrggbb)"),
      accent: z.string().refine(isValidHex, "Color hex inválido (#rrggbb)"),
    })
    .optional(),
});

export const PUT = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede cambiar la marca");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  // Save parcial: el icono y los colores de PDF que no vienen en el body se
  // conservan, y el nombre guardado tampoco se pisa si el panel ya no lo edita.
  await saveBranding(session.organizationId, {
    name: body.data.name,
    accent: body.data.accent,
    currency: body.data.currency,
    pdfColors: body.data.pdfColors,
  });
  return Response.json({ ok: true });
});
