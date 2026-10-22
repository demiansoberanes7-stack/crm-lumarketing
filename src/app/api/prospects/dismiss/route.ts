import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  dismissProspect,
  prospectTargetOf,
  restoreProspect,
} from "@/server/prospects/dismiss";

export const dynamic = "force-dynamic";

/**
 * Descartar / restaurar un prospecto.
 *
 * Es una marca de pantalla, no un borrado: `POST` oculta la tarjeta y `DELETE`
 * la devuelve. No se borra ni el contacto ni sus mensajes —en el correo ni
 * siquiera hay contacto que borrar—, así que el historial de un cliente nunca
 * se pierde por limpiar la lista.
 *
 * `withAuth`, no `withOwner`: archivar y descartar gente es parte del trabajo
 * diario de cualquier miembro, igual que `PATCH /api/contacts/[id]` con
 * `archived`.
 */
const bodySchema = z.object({
  contactId: z.string().trim().max(255).nullish(),
  email: z.string().trim().max(254).nullish(),
});

async function targetOf(body: z.infer<typeof bodySchema>) {
  const target = prospectTargetOf(body);
  if (!target) {
    return apiError(
      422,
      "invalid_body",
      "Indica el prospecto a descartar: un contacto o una dirección de correo"
    );
  }
  return { target } as const;
}

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const parsed = await targetOf(body.data);
  if (!("target" in parsed)) return parsed;
  await dismissProspect(session.organizationId, session.userId, parsed.target);
  return Response.json({ dismissed: true });
});

/**
 * `DELETE` se resuelve por query, como `DELETE /api/caltodo/tasks?id=`: en esta
 * API los borrados no llevan body, y un cuerpo en una petición DELETE no está
 * garantizado por los intermediarios. La dirección va codificada —`?email=`
 * admite `@` y `.`, pero no cualquier carácter—.
 */
export const DELETE = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const parsed = await targetOf({
    contactId: url.searchParams.get("contactId"),
    email: url.searchParams.get("email"),
  });
  if (!("target" in parsed)) return parsed;
  await restoreProspect(session.organizationId, parsed.target);
  return Response.json({ restored: true });
});
