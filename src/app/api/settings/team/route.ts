import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const members = await db
    .select({
      id: schema.member.id,
      role: schema.member.role,
      createdAt: schema.member.createdAt,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(scoped(schema.member.organizationId, session.organizationId));
  return Response.json({
    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      name: m.name,
      email: m.email,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

/** Alta de cuenta de equipo (owner only): email + contraseña temporal (FR-061). */
export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede crear cuentas");
  }
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const auth = getAuth();
  let newUserId: string;
  try {
    const result = await runInternalSignup(() =>
      auth.api.signUpEmail({
        body: {
          name: body.data.name,
          email: body.data.email,
          password: body.data.password,
        },
      })
    );
    newUserId = result.user.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    // zod ya validó formato y longitud de la contraseña, así que el texto de
    // Better Auth nunca aporta algo accionable al usuario: solo filtraría
    // detalles internos de la instancia.
    console.error("[settings/team] Alta de miembro falló:", err);
    if (/exist|in use/i.test(message)) {
      return apiError(409, "duplicate", "Ya existe una cuenta con ese correo");
    }
    return apiError(422, "member_creation_failed", "No se pudo crear la cuenta del miembro");
  }

  const db = getDb();
  await db
    .insert(schema.member)
    .values({
      id: newId("member"),
      organizationId: session.organizationId,
      userId: newUserId,
      role: "member",
    })
    .onConflictDoNothing();

  return Response.json({ ok: true }, { status: 201 });
});

const deleteSchema = z.object({ memberId: z.string().min(1) });

/**
 * Baja de un miembro del negocio. Nunca borra al propietario ni la propia
 * cuenta. Si la persona no pertenece a otro negocio, se elimina su cuenta
 * completa (sesiones y credenciales incluidas) para que conserve el correo
 * disponible; si pertenece a otro, solo se retira la membresía.
 */
export const DELETE = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede eliminar miembros");
  }
  const body = await parseBody(req, deleteSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const target = await db
    .select({ id: schema.member.id, userId: schema.member.userId, role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        scoped(schema.member.organizationId, session.organizationId),
        eq(schema.member.id, body.data.memberId)
      )
    )
    .limit(1)
    .then((rows) => rows[0]);

  if (!target) return apiError(404, "not_found", "Miembro no encontrado");
  if (target.userId === session.userId) {
    return apiError(400, "self_delete", "No puedes eliminar tu propia cuenta");
  }
  if (target.role === "owner") {
    return apiError(400, "owner_protected", "No se puede eliminar al propietario del negocio");
  }

  const [memberships] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.member)
    .where(eq(schema.member.userId, target.userId));

  try {
    if ((memberships?.count ?? 0) > 1) {
      await db.delete(schema.member).where(eq(schema.member.id, target.id));
    } else {
      await db.delete(schema.user).where(eq(schema.user.id, target.userId));
    }
  } catch (err) {
    console.error("[settings/team] Baja de miembro falló:", err);
    return apiError(409, "member_delete_failed", "No se pudo eliminar el miembro. Vuelve a intentarlo.");
  }

  return Response.json({ ok: true });
});
