import { asc, count, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { StageKind } from "@/lib/types";
import { ACQUISITION_CHANNELS, UNKNOWN_CHANNEL } from "@/lib/acquisition-channel";
import { LOSS_REASON_KEYS, LOSS_REASON_KEY_LABELS } from "@/lib/loss-reason";

/** Etapas sembradas del pipeline (US2). */
const SEED_STAGES: { name: string; kind: StageKind }[] = [
  { name: "Nuevo", kind: "open" },
  { name: "En conversación", kind: "open" },
  { name: "Interesado", kind: "open" },
  { name: "Calificado", kind: "qualified" },
  { name: "Cliente", kind: "won" },
  { name: "Perdido", kind: "lost" },
];

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Clave fija del lock de "primer arranque" de la instancia. */
const BOOTSTRAP_LOCK_KEY = 874201;

/**
 * `organization.slug` es UNIQUE pero ninguna ruta lo consulta: sirve para que
 * dos negocios con el mismo nombre no choquen al insertarse.
 */
export function slugifyOrganizationName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "negocio";
}

async function slugTaken(tx: Tx, slug: string): Promise<boolean> {
  const rows = await tx
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.slug, slug))
    .limit(1);
  return rows.length > 0;
}

/** Candidatos deterministas: `mi-peluqueria`, `mi-peluqueria-2`, … y uno con sello de tiempo. */
function slugCandidates(base: string): string[] {
  const out: string[] = [base];
  for (let i = 2; i <= 12; i++) out.push(`${base}-${i}`);
  out.push(`${base}-${Date.now().toString(36)}`);
  return out;
}

async function pickFreeSlug(tx: Tx, name: string): Promise<string> {
  const base = slugifyOrganizationName(name);
  for (const candidate of slugCandidates(base)) {
    if (!(await slugTaken(tx, candidate))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Configuración mínima que un negocio necesita para que la instancia le sirva:
 * pipeline, catálogo de canales, motivos de pérdida y perfil del agente.
 *
 * Todo lo demás (etapas de proyecto, términos de INTEL, ajustes de agenda,
 * credenciales de WhatsApp) se crea perezosamente al primer uso, así que
 * sembrar estas cuatro tablas es suficiente para que un negocio nuevo no
 * aparezca vacío ni roto.
 */
async function seedOrganization(tx: Tx, organizationId: string): Promise<void> {
  await tx.insert(schema.pipelineStage).values(
    SEED_STAGES.map((s, i) => ({
      id: newId("stage"),
      organizationId,
      name: s.name,
      position: i,
      kind: s.kind,
    }))
  );
  // Catálogo de canales de adquisición (configuración, no datos de negocio).
  await tx.insert(schema.acquisitionChannel).values(
    [...ACQUISITION_CHANNELS, UNKNOWN_CHANNEL].map((c, i) => ({
      id: newId("acquisitionChannel"),
      organizationId,
      name: c.name,
      kind: c.kind,
      sortOrder: i,
    }))
  );
  // Catálogo normalizado de motivos de pérdida (configuración).
  await tx.insert(schema.lossReasonCatalog).values(
    LOSS_REASON_KEYS.map((key, i) => ({
      id: newId("lossReason"),
      organizationId,
      key,
      label: LOSS_REASON_KEY_LABELS[key],
      sortOrder: i,
    }))
  );
  await tx.insert(schema.agentProfile).values({
    id: newId("agentProfile"),
    organizationId,
  });
}

async function insertOrganizationWithOwner(
  tx: Tx,
  userId: string,
  name: string,
  slug: string
): Promise<string> {
  const organizationId = newId("organization");
  await tx.insert(schema.organization).values({ id: organizationId, name, slug });
  await tx.insert(schema.member).values({
    id: newId("member"),
    organizationId,
    userId,
    role: "owner",
  });
  await seedOrganization(tx, organizationId);
  return organizationId;
}

export type ProvisionOutcome =
  | { ok: true; organizationId: string; created: true }
  | { ok: true; organizationId: string; created: false }
  | { ok: false; error: string };

/**
 * Crear el negocio de un usuario que aún no pertenece a ninguno.
 *
 * Es el camino de alta de clientes (registro público con `ALLOW_SIGNUP=true` o
 * provisión desde Ajustes → Equipo). Dos llamadas simultáneas del mismo usuario
 * no crean dos organizaciones: el lock va por `hashtext(userId)` y dentro del
 * lock se re-lee la membresía.
 */
export async function provisionOrganization(
  userId: string,
  businessName: string
): Promise<ProvisionOutcome> {
  const name = businessName.trim().slice(0, 120);
  if (name.length < 2) {
    return { ok: false, error: "El nombre del negocio es demasiado corto" };
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const existing = await tx
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .where(eq(schema.member.userId, userId))
      .orderBy(asc(schema.member.createdAt), asc(schema.member.id))
      .limit(1);
    const mine = existing[0]?.organizationId;
    if (mine) return { ok: true, organizationId: mine, created: false };

    const slug = await pickFreeSlug(tx, name);
    const organizationId = await insertOrganizationWithOwner(tx, userId, name, slug);
    return { ok: true, organizationId, created: true };
  });
}

/**
 * Primer registro de la instancia: crea la organización, deja al usuario como
 * propietario y siembra la configuración inicial.
 *
 * Solo actúa si NO existe ninguna organización; los negocios siguientes crean
 * el suyo propio con `provisionOrganization`. Un advisory lock evita que dos
 * registros simultáneos en instancia vacía creen dos organizaciones.
 */
export async function onUserCreated(userId: string, userName: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    // Lock transaccional de "primer arranque" (clave arbitraria fija):
    // dos registros simultáneos en instancia vacía → solo uno crea la org.
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`);
    const [orgs] = await tx.select({ n: count() }).from(schema.organization);
    if ((orgs?.n ?? 0) > 0) return;

    const name = userName ? `Negocio de ${userName}` : "Mi negocio";
    await insertOrganizationWithOwner(tx, userId, name, "principal");
  });
}

/**
 * Dueño de la instancia = propietario de la organización más antigua.
 *
 * El alto de NEGOCIOS nuevos no es una operación de cualquier owner: en una
 * instancia atendida por una agencia, solo quien la operó desde el principio
 * puede abrir tenants. Un owner de un negocio ya creado sigue administrando el
 * suyo, pero no puede generar clientes nuevos.
 */
export async function isInstanceOwner(userId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ ownerOfFirst: schema.member.userId })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
    .where(eq(schema.member.role, "owner"))
    .orderBy(asc(schema.organization.createdAt), asc(schema.organization.id))
    .limit(1);
  return rows[0]?.ownerOfFirst === userId;
}

/** Organización activa de un usuario (su primera membresía). */
export async function resolveActiveOrganizationId(
  userId: string
): Promise<string | null> {
  return (await resolveMembership(userId))?.organizationId ?? null;
}

export async function resolveMembership(
  userId: string
): Promise<{ organizationId: string; role: string } | null> {
  const db = getDb();
  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    // Orden determinista: con varias membresías, "la primera" sin ORDER BY
    // dependía del plan de consulta y podía cambiar entre llamadas.
    .orderBy(asc(schema.member.createdAt), asc(schema.member.id))
    .limit(1);
  return rows[0] ?? null;
}
