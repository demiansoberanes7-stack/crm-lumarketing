import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { removeOrganizationMedia } from "@/server/media-path";

/**
 * Operaciones del operador de la instancia sobre OTROS negocios: listarlos con
 * contexto, restablecer la contraseña de una cuenta y borrar un negocio entero.
 *
 * La autorización (rol owner + `isInstanceOwner`) vive en la ruta. Aquí solo se
 * revalida lo que depende del estado de la BD —membresía, negocio protegido,
 * nombre de confirmación— dentro de la misma transacción que escribe.
 */

export type InstanceAdminActor = {
  userId: string;
  organizationId: string;
};

export class InstanceAdminError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "InstanceAdminError";
    this.status = status;
    this.code = code;
  }
}

export type InstancePerson = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

export type InstanceOrganization = {
  id: string;
  name: string;
  slug: string | null;
  createdAt: string;
  members: number;
  isPrincipal: boolean;
  canDelete: boolean;
  people: InstancePerson[];
  stats: {
    contacts: number;
    conversations: number;
    quotes: number;
    projects: number;
  };
};

const EMPTY_STATS = { contacts: 0, conversations: 0, quotes: 0, projects: 0 };

function countByOrganization(
  rows: { organizationId: string; n: number }[]
): Map<string, number> {
  return new Map(rows.map((r) => [r.organizationId, r.n]));
}

/** Listado del porfolio para la tarjeta de Equipo (solo llega el operador). */
export async function listInstanceOrganizations(
  actor: InstanceAdminActor
): Promise<{
  viewerUserId: string;
  viewerOrganizationId: string;
  organizations: InstanceOrganization[];
}> {
  const db = getDb();
  const orgs = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      createdAt: schema.organization.createdAt,
      members: sql<number>`count(${schema.member.id})::int`,
    })
    .from(schema.organization)
    .leftJoin(schema.member, eq(schema.member.organizationId, schema.organization.id))
    .groupBy(schema.organization.id)
    .orderBy(asc(schema.organization.createdAt), asc(schema.organization.id));

  if (orgs.length === 0) {
    return {
      viewerUserId: actor.userId,
      viewerOrganizationId: actor.organizationId,
      organizations: [],
    };
  }

  const ids = orgs.map((o) => o.id);
  const [peopleRows, contactRows, conversationRows, quoteRows, projectRows] =
    await Promise.all([
      db
        .select({
          organizationId: schema.member.organizationId,
          userId: schema.user.id,
          name: schema.user.name,
          email: schema.user.email,
          role: schema.member.role,
          memberCreatedAt: schema.member.createdAt,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
        .where(inArray(schema.member.organizationId, ids))
        .orderBy(
          asc(schema.member.organizationId),
          asc(schema.member.createdAt),
          asc(schema.member.id)
        ),
      db
        .select({
          organizationId: schema.contact.organizationId,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.contact)
        .where(inArray(schema.contact.organizationId, ids))
        .groupBy(schema.contact.organizationId),
      db
        .select({
          organizationId: schema.conversation.organizationId,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.conversation)
        .where(inArray(schema.conversation.organizationId, ids))
        .groupBy(schema.conversation.organizationId),
      db
        .select({
          organizationId: schema.quote.organizationId,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.quote)
        .where(inArray(schema.quote.organizationId, ids))
        .groupBy(schema.quote.organizationId),
      db
        .select({
          organizationId: schema.project.organizationId,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.project)
        .where(inArray(schema.project.organizationId, ids))
        .groupBy(schema.project.organizationId),
    ]);

  const peopleByOrg = new Map<string, InstancePerson[]>();
  for (const row of peopleRows) {
    const list = peopleByOrg.get(row.organizationId) ?? [];
    list.push({
      userId: row.userId,
      name: row.name,
      email: row.email,
      role: row.role,
    });
    peopleByOrg.set(row.organizationId, list);
  }
  // El owner primero: es la cuenta que el operador normalmente quiere rescatar.
  for (const list of peopleByOrg.values()) {
    list.sort((a, b) => {
      if (a.role === "owner" && b.role !== "owner") return -1;
      if (b.role === "owner" && a.role !== "owner") return 1;
      return a.name.localeCompare(b.name, "es");
    });
  }

  const contacts = countByOrganization(contactRows);
  const conversations = countByOrganization(conversationRows);
  const quotes = countByOrganization(quoteRows);
  const projects = countByOrganization(projectRows);

  const principalId = orgs[0]?.id;
  return {
    viewerUserId: actor.userId,
    viewerOrganizationId: actor.organizationId,
    organizations: orgs.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      createdAt: org.createdAt.toISOString(),
      members: org.members,
      isPrincipal: org.id === principalId,
      // El negocio con el que se está trabajando tampoco se borra: sería un
      // auto-bloqueo inmediato para el operador.
      canDelete: org.id !== principalId && org.id !== actor.organizationId,
      people: peopleByOrg.get(org.id) ?? [],
      stats: {
        contacts: contacts.get(org.id) ?? EMPTY_STATS.contacts,
        conversations: conversations.get(org.id) ?? EMPTY_STATS.conversations,
        quotes: quotes.get(org.id) ?? EMPTY_STATS.quotes,
        projects: projects.get(org.id) ?? EMPTY_STATS.projects,
      },
    })),
  };
}

export type ResetPasswordResult = {
  email: string;
  sessionsRevoked: number;
  tokensRevoked: number;
};

/**
 * Restablece la contraseña de una cuenta que pertenece al negocio indicado.
 *
 * El hash sale de `better-auth/crypto` —la misma función con la que el login
 * verifica— y se comprueba contra sí mismo antes de escribir: si la librería
 * cambia de formato, es mejor un 500 aquí que dejar al cliente sin poder entrar.
 * Se revocan sesiones y tokens MCP para que la contraseña vieja no siga viva en
 * una pestaña o en ChatGPT.
 */
export async function resetMemberPassword(
  actor: InstanceAdminActor,
  input: { organizationId: string; userId: string; password: string }
): Promise<ResetPasswordResult> {
  if (input.password.length < 8 || input.password.length > 128) {
    throw new InstanceAdminError(
      422,
      "invalid_password",
      "La contraseña debe tener entre 8 y 128 caracteres"
    );
  }

  const db = getDb();
  const [target] = await db
    .select({
      organizationName: schema.organization.name,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(
      schema.organization,
      eq(schema.member.organizationId, schema.organization.id)
    )
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(
      and(
        eq(schema.member.organizationId, input.organizationId),
        eq(schema.member.userId, input.userId)
      )
    )
    .limit(1);

  if (!target) {
    throw new InstanceAdminError(
      404,
      "member_not_found",
      "La cuenta no pertenece a ese negocio"
    );
  }

  const [actorRow] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, actor.userId))
    .limit(1);
  if (!actorRow) {
    throw new InstanceAdminError(401, "unauthorized", "La cuenta del operador no existe");
  }

  const hash = await hashPassword(input.password);
  if (!(await verifyPassword({ hash, password: input.password }))) {
    // Mismo canario que scripts/reset-password.mjs: un cambio de formato en
    // Better Auth debe romper aquí, no al intentar entrar con la nueva clave.
    throw new Error("El hash generado por Better Auth no se verifica a sí mismo");
  }

  const outcome = await db.transaction(async (tx) => {
    // La membresía se re-lee con lock: entre la comprobación y la escritura
    // alguien pudo sacar a la cuenta del negocio.
    const [membership] = await tx
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, input.organizationId),
          eq(schema.member.userId, input.userId)
        )
      )
      .limit(1)
      .for("update");
    if (!membership) {
      throw new InstanceAdminError(
        404,
        "member_not_found",
        "La cuenta ya no pertenece a ese negocio"
      );
    }

    const [credential] = await tx
      .select({ id: schema.account.id })
      .from(schema.account)
      .where(
        and(
          eq(schema.account.userId, input.userId),
          eq(schema.account.providerId, "credential")
        )
      )
      .limit(1);

    if (credential) {
      await tx
        .update(schema.account)
        .set({ password: hash, updatedAt: new Date() })
        .where(eq(schema.account.id, credential.id));
    } else {
      // Cuenta sin contraseña local (p. ej. alta futura por OAuth): se le crea
      // una credencial para que la nueva clave sirva desde el primer login.
      await tx.insert(schema.account).values({
        id: newId("account"),
        accountId: input.userId,
        providerId: "credential",
        userId: input.userId,
        password: hash,
      });
    }

    const sessions = await tx
      .delete(schema.session)
      .where(eq(schema.session.userId, input.userId))
      .returning({ id: schema.session.id });
    const tokens = await tx
      .delete(schema.mcpAccessToken)
      .where(eq(schema.mcpAccessToken.userId, input.userId))
      .returning({ id: schema.mcpAccessToken.id });
    const codes = await tx
      .delete(schema.mcpAuthorizationCode)
      .where(eq(schema.mcpAuthorizationCode.userId, input.userId))
      .returning({ id: schema.mcpAuthorizationCode.id });

    await tx.insert(schema.instanceAdminAudit).values({
      id: newId("instanceAdminAudit"),
      actorUserId: actor.userId,
      actorEmail: actorRow.email,
      action: "member.password.reset",
      targetOrganizationId: input.organizationId,
      targetOrganizationName: target.organizationName,
      targetUserId: input.userId,
      targetUserEmail: target.email,
      metadata: {
        sessionsRevoked: sessions.length,
        tokensRevoked: tokens.length + codes.length,
      },
    });

    return {
      sessionsRevoked: sessions.length,
      tokensRevoked: tokens.length + codes.length,
    };
  });

  console.info(
    `[instance-admin] contraseña restablecida org=${input.organizationId} user=${input.userId} actor=${actor.userId}`
  );

  return { email: target.email, ...outcome };
}

export type DeleteOrganizationResult = {
  organizationName: string;
  usersDeleted: number;
  stats: {
    contacts: number;
    conversations: number;
    quotes: number;
    projects: number;
    members: number;
  };
  mediaRemoved: boolean;
};

/**
 * Borra un negocio y todo su dominio.
 *
 * Las claves foráneas ya están en cascada (verificado en `pg_constraint`), así
 * que basta borrar `organization`. Aparte se eliminan las cuentas cuya ÚNICA
 * membresía era este negocio; las que también pertenecen a otro solo pierden la
 * membresía por la cascada. La media del volumen se retira después del commit:
 * si falla, el negocio ya no existe y solo quedan archivos huérfanos, nunca un
 * negocio vivo sin sus archivos.
 */
export async function deleteInstanceOrganization(
  actor: InstanceAdminActor,
  input: { organizationId: string; confirmName: string }
): Promise<DeleteOrganizationResult> {
  const db = getDb();
  const [actorRow] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, actor.userId))
    .limit(1);
  if (!actorRow) {
    throw new InstanceAdminError(401, "unauthorized", "La cuenta del operador no existe");
  }

  const outcome = await db.transaction(async (tx) => {
    const [org] = await tx
      .select({ id: schema.organization.id, name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, input.organizationId))
      .limit(1)
      .for("update");
    if (!org) {
      throw new InstanceAdminError(404, "not_found", "El negocio no existe");
    }
    if (org.id === actor.organizationId) {
      throw new InstanceAdminError(
        400,
        "active_organization",
        "No puedes borrar el negocio con el que estás trabajando"
      );
    }

    const [oldest] = await tx
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .orderBy(asc(schema.organization.createdAt), asc(schema.organization.id))
      .limit(1);
    if (oldest?.id === org.id) {
      throw new InstanceAdminError(
        400,
        "principal_organization",
        "El negocio principal de la instancia no se puede borrar"
      );
    }

    const [totalOrgs] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.organization);
    if ((totalOrgs?.n ?? 0) <= 1) {
      throw new InstanceAdminError(
        400,
        "last_organization",
        "No se puede borrar el último negocio de la instancia"
      );
    }

    if (input.confirmName.trim() !== org.name) {
      throw new InstanceAdminError(
        422,
        "confirm_name_mismatch",
        "Escribe el nombre exacto del negocio para confirmar"
      );
    }

    const memberRows = await tx
      .select({ userId: schema.member.userId })
      .from(schema.member)
      .where(eq(schema.member.organizationId, org.id));
    const userIds = [...new Set(memberRows.map((r) => r.userId))];

    let orphanUserIds: string[] = [];
    if (userIds.length > 0) {
      const memberships = await tx
        .select({
          userId: schema.member.userId,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.member)
        .where(inArray(schema.member.userId, userIds))
        .groupBy(schema.member.userId);
      orphanUserIds = memberships
        .filter((m) => m.n === 1 && m.userId !== actor.userId)
        .map((m) => m.userId);
    }

    const [contacts] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.contact)
      .where(eq(schema.contact.organizationId, org.id));
    const [conversations] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.conversation)
      .where(eq(schema.conversation.organizationId, org.id));
    const [quotes] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.quote)
      .where(eq(schema.quote.organizationId, org.id));
    const [projects] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.project)
      .where(eq(schema.project.organizationId, org.id));

    const stats = {
      contacts: contacts?.n ?? 0,
      conversations: conversations?.n ?? 0,
      quotes: quotes?.n ?? 0,
      projects: projects?.n ?? 0,
      members: memberRows.length,
    };

    await tx
      .delete(schema.organization)
      .where(eq(schema.organization.id, org.id));

    if (orphanUserIds.length > 0) {
      // La cascada de user borra sesiones, credenciales, membresías restantes
      // y tokens MCP. Solo llegan aquí cuentas sin otro negocio.
      await tx
        .delete(schema.user)
        .where(inArray(schema.user.id, orphanUserIds));
    }

    await tx.insert(schema.instanceAdminAudit).values({
      id: newId("instanceAdminAudit"),
      actorUserId: actor.userId,
      actorEmail: actorRow.email,
      action: "organization.delete",
      targetOrganizationId: org.id,
      targetOrganizationName: org.name,
      metadata: {
        ...stats,
        usersDeleted: orphanUserIds.length,
      },
    });

    return {
      organizationName: org.name,
      usersDeleted: orphanUserIds.length,
      stats,
    };
  });

  let mediaRemoved = false;
  try {
    mediaRemoved = await removeOrganizationMedia(input.organizationId);
  } catch (err) {
    console.warn(
      `[instance-admin] el negocio ${input.organizationId} se borró pero su media no:`,
      err
    );
  }

  console.info(
    `[instance-admin] negocio borrado org=${input.organizationId} users=${outcome.usersDeleted} actor=${actor.userId}`
  );

  return { ...outcome, mediaRemoved };
}
