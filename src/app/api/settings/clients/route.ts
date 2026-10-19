import { asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { isInstanceOwner, provisionOrganization } from "@/server/auth/on-signup";

export const dynamic = "force-dynamic";

/**
 * Altas de clientes de la instancia (multi-negocio en un mismo despliegue).
 *
 * Dos formas de tener más de un negocio aislado, y esta es la controlada: el
 * operador de la instancia crea la cuenta y el negocio del cliente en un solo
 * paso, sin abrir el registro público. El aislamiento es el de siempre —toda
 * tabla de dominio filtra por `organization_id`— y cada negocio nace con su
 * propia configuración (pipeline, canales, motivos de pérdida, agente).
 */

// No se comparte una instancia de Response: su body se consume al primer uso.
const notInstanceOwner = () =>
  apiError(
    403,
    "not_instance_owner",
    "Solo quien opera esta instancia puede dar de alta negocios nuevos"
  );

/** El listado cruza tenants, así que es exclusivamente del operador. */
export const GET = withAuth(async (session) => {
  if (session.role !== "owner") return notInstanceOwner();
  if (!(await isInstanceOwner(session.userId))) return notInstanceOwner();

  const db = getDb();
  const rows = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      createdAt: schema.organization.createdAt,
      members: count(schema.member.id),
    })
    .from(schema.organization)
    .leftJoin(schema.member, eq(schema.member.organizationId, schema.organization.id))
    .groupBy(schema.organization.id)
    .orderBy(asc(schema.organization.createdAt), asc(schema.organization.id));

  return Response.json({
    organizations: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      members: r.members,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

const createSchema = z
  .object({
    businessName: z.string().trim().min(2).max(120),
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email(),
    password: z.string().min(8).max(128),
  })
  .strict();

/** Alta de un negocio con su cuenta administradora (contraseña temporal, FR-061). */
export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede crear cuentas");
  }
  if (!(await isInstanceOwner(session.userId))) return notInstanceOwner();

  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const auth = getAuth();
  let newUserId: string;
  try {
    const created = await runInternalSignup(() =>
      auth.api.signUpEmail({
        body: {
          name: body.data.name,
          email: body.data.email,
          password: body.data.password,
        },
      })
    );
    newUserId = created.user.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo crear la cuenta";
    if (/exist/i.test(message)) {
      return apiError(409, "duplicate", "Ya existe una cuenta con ese correo");
    }
    return apiError(422, "invalid", message);
  }

  // Si esto falla el usuario queda sin negocio; al entrar le sobra nombrarlo en
  // /crear-negocio, así que no se borra la cuenta que acabamos de crear.
  const outcome = await provisionOrganization(newUserId, body.data.businessName);
  if (!outcome.ok) {
    return apiError(422, "invalid_business_name", outcome.error);
  }

  return Response.json(
    { organizationId: outcome.organizationId, email: body.data.email },
    { status: 201 }
  );
});
