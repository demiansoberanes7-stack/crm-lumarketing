import { headers } from "next/headers";
import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { AUTH_RATE_LIMIT, checkDistributedRateLimit } from "@/lib/rate-limit";
import { provisionOrganization } from "@/server/auth/on-signup";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ name: z.string().trim().min(2).max(120) }).strict();

/**
 * Crea el negocio de la cuenta que acaba de registrarse.
 *
 * A propósito no usa `withAuth`: `requireSession()` exige una membresía y este
 * usuario todavía no tiene ninguna —ese es exactamente el estado que resuelve
 * esta ruta. La guardia es la misma condición: `provisionOrganization` solo
 * crea algo si el usuario no pertenece a ningún negocio, así que un cliente no
 * puede reclamarse un segundo tenant. Llegar aquí ya implica haber pasado el
 * gate de `/sign-up/email` (FR-060) o haber sido provisionado por la instancia.
 */
export const POST = async (req: Request) => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return apiError(401, "unauthorized", "No autenticado");

  // Sin esto, una sesión robada se reenvía a sí misma nombres de negocio en
  // bucle. La clave es el id de usuario: el alta solo compete a esa cuenta.
  const limited = await checkDistributedRateLimit(
    `org-provision:${session.user.id}`,
    AUTH_RATE_LIMIT
  );
  if (!limited.allowed) {
    return apiError(429, "rate_limited", "Demasiados intentos; espera unos minutos");
  }

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  try {
    const outcome = await provisionOrganization(session.user.id, body.data.name);
    if (!outcome.ok) {
      return apiError(422, "invalid_name", outcome.error);
    }
    return Response.json(
      { organizationId: outcome.organizationId, created: outcome.created },
      { status: outcome.created ? 201 : 200 }
    );
  } catch {
    return apiError(500, "internal", "No se pudo crear el negocio");
  }
};
