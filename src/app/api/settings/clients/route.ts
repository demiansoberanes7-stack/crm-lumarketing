import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import type { SessionContext } from "@/lib/auth/session";
import { getAuth, runInternalSignup } from "@/lib/auth";
import {
  deleteInstanceOrganization,
  InstanceAdminError,
  listInstanceOrganizations,
  resetMemberPassword,
} from "@/server/auth/instance-admin";
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
 *
 * Las acciones destructivas (borrar negocio, cambiar contraseña de otra cuenta)
 * son exclusivas del operador de la instancia y se revalidan contra la BD.
 */

// No se comparte una instancia de Response: su body se consume al primer uso.
const notInstanceOwner = () =>
  apiError(
    403,
    "not_instance_owner",
    "Solo quien opera esta instancia puede administrar los negocios"
  );

async function isInstanceOperator(session: SessionContext): Promise<boolean> {
  return session.role === "owner" && (await isInstanceOwner(session.userId));
}

/** El listado cruza tenants, así que es exclusivamente del operador. */
export const GET = withAuth(async (session) => {
  if (!(await isInstanceOperator(session))) return notInstanceOwner();

  return Response.json(
    await listInstanceOrganizations({
      userId: session.userId,
      organizationId: session.organizationId,
    })
  );
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
    const message = err instanceof Error ? err.message : "";
    // El texto crudo de Better Auth (o de Postgres) no sale al navegador: puede
    // nombrar tablas, columnas o el estado interno de la instancia. Se registra
    // aquí y al cliente se le devuelve un motivo accionable.
    console.error("[settings/clients] Alta de cliente falló:", err);
    if (/exist|in use/i.test(message)) {
      return apiError(409, "duplicate", "Ya existe una cuenta con ese correo");
    }
    return apiError(422, "client_creation_failed", "No se pudo crear la cuenta del cliente");
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

const resetPasswordSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(255),
    userId: z.string().trim().min(1).max(255),
    password: z.string().min(8).max(128),
  })
  .strict();

/**
 * Cambia la contraseña de una cuenta de otro negocio. La cuenta debe seguir
 * siendo miembro del negocio indicado —lo revalida el servicio dentro de la
 * transacción— y se revocan todas sus sesiones y tokens MCP.
 */
export const PATCH = withAuth(async (session, req: Request) => {
  if (!(await isInstanceOperator(session))) return notInstanceOwner();

  const body = await parseBody(req, resetPasswordSchema);
  if (!body.ok) return body.response;

  try {
    const result = await resetMemberPassword(
      { userId: session.userId, organizationId: session.organizationId },
      body.data
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof InstanceAdminError) {
      return apiError(err.status, err.code, err.message);
    }
    throw err;
  }
});

const deleteSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(255),
    /** Nombre exacto del negocio; se valida otra vez en el servidor. */
    confirmName: z.string().min(1).max(255),
  })
  .strict();

/**
 * Borra un negocio y todo su dominio. El negocio principal, el de la sesión
 * activa y el último de la instancia están protegidos. La confirmación por
 * nombre no sustituye a la autorización: es la barrera contra un clic de más.
 */
export const DELETE = withAuth(async (session, req: Request) => {
  if (!(await isInstanceOperator(session))) return notInstanceOwner();

  const body = await parseBody(req, deleteSchema);
  if (!body.ok) return body.response;

  try {
    const result = await deleteInstanceOrganization(
      { userId: session.userId, organizationId: session.organizationId },
      body.data
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof InstanceAdminError) {
      return apiError(err.status, err.code, err.message);
    }
    throw err;
  }
});
