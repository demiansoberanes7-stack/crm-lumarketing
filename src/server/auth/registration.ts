import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/** Organizaciones existentes en esta instancia. */
export async function countOrganizations(): Promise<number> {
  const db = getDb();
  const rows = await db.select({ n: count() }).from(schema.organization);
  return rows[0]?.n ?? 0;
}

/**
 * Registro público cerrado tras la primera organización (FR-060), salvo la
 * variable de escape `ALLOW_SIGNUP=true`.
 *
 * El escape ya no significa "todos entran al mismo negocio": quien se registra
 * con él abierto crea SU propio negocio en el siguiente paso (`/crear-negocio`),
 * con su organización y su configuración. Las cuentas de equipo las crea el
 * propietario de cada negocio y reciben membresía explícita, sin pasar por aquí.
 */
export async function isPublicSignupAllowed(): Promise<boolean> {
  if (process.env.ALLOW_SIGNUP === "true") return true;
  return (await countOrganizations()) === 0;
}

/** Lo que necesita la pantalla de acceso para ofrecer el alta con honestidad. */
export async function getSignupState(): Promise<{
  allowed: boolean;
  hasOrganizations: boolean;
}> {
  const organizations = await countOrganizations();
  const hasOrganizations = organizations > 0;
  return {
    allowed: hasOrganizations ? process.env.ALLOW_SIGNUP === "true" : true,
    hasOrganizations,
  };
}
