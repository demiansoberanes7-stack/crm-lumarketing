import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { ProjectError } from "./errors";

export async function listProjectMembers(organizationId: string) {
  return getDb().select({ userId: schema.user.id, name: schema.user.name, email: schema.user.email })
    .from(schema.member).innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(scoped(schema.member.organizationId, organizationId)).orderBy(schema.user.name);
}

export async function validateProjectMember(organizationId: string, userId?: string | null) {
  if (!userId) return;
  const [member] = await getDb().select({ id: schema.member.id }).from(schema.member)
    .where(scoped(schema.member.organizationId, organizationId, eq(schema.member.userId, userId))).limit(1);
  if (!member) throw new ProjectError(422, "El responsable debe ser un miembro de tu organización");
}
