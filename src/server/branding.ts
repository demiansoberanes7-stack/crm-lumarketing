import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getSessionOrNull } from "@/lib/auth/session";
import {
  DEFAULT_BRANDING,
  normalizeBranding,
  type Branding,
} from "@/lib/branding";
import { normalizeBusinessSettings } from "@/lib/business-settings";

/** Marca guardada en organization.metadata (JSON de Better Auth). */

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * El nombre visible del CRM es el del negocio (Datos de Empresa); la marca
 * solo conserva el nombre como respaldo para negocios que aún no lo llenaron.
 * Así la cabecera y la pestaña del navegador dicen lo mismo que las
 * cotizaciones y nunca dos nombres distintos.
 */
function brandingWithBusinessName(
  branding: Branding,
  metadata: Record<string, unknown>
): Branding {
  const business = normalizeBusinessSettings(
    (metadata.businessSettings as Parameters<typeof normalizeBusinessSettings>[0]) ?? null
  );
  return business.companyName ? { ...branding, name: business.companyName } : branding;
}

/**
 * Marca + a qué organización pertenece.
 *
 * El icono se guarda como archivo en `MEDIA_DIR/{organizationId}/favicon`, así
 * que servirlo necesita el id — y la ruta que lo sirve es pública (el login
 * también tiene pestaña), donde no hay sesión de la que sacarlo.
 */
export async function getBrandingContext(
  organizationId?: string | null
): Promise<{ organizationId: string | null; branding: Branding }> {
  const db = getDb();
  const rows = organizationId
    ? await db
        .select({ id: schema.organization.id, metadata: schema.organization.metadata })
        .from(schema.organization)
        .where(eq(schema.organization.id, organizationId))
        .limit(1)
    : // Sin sesión (login, layout raíz). Con UNA organización la marca de la
      // instancia es la suya; con dos o más, ninguna: la pantalla pública de
      // acceso no puede mostrar el logo ni el nombre de un cliente concreto.
      // `limit(2)` distingue "única" de "varias" sin contar la tabla.
      await db
        .select({ id: schema.organization.id, metadata: schema.organization.metadata })
        .from(schema.organization)
        .limit(2);
  if (rows.length !== 1 || !rows[0]) {
    return { organizationId: null, branding: DEFAULT_BRANDING };
  }
  const meta = parseMetadata(rows[0].metadata);
  return {
    organizationId: rows[0].id,
    branding: brandingWithBusinessName(
      normalizeBranding((meta.branding as Partial<Branding> | undefined) ?? null),
      meta
    ),
  };
}

export async function getBranding(
  organizationId?: string | null
): Promise<Branding> {
  return (await getBrandingContext(organizationId)).branding;
}

/**
 * Marca de la petición que se está sirviendo: la del negocio de la sesión.
 *
 * El layout raíz es el único que inyecta las variables CSS del acento
 * (`accentCssVariables`) y el título y el favicon del documento. Si llamara a
 * `getBranding()` a secas, con dos negocios en la instancia caería en la marca
 * neutra —el acotamiento existe para las páginas públicas, pero el documento ya
 * autenticado se quedaba sin el color que su dueño sí guardó.
 *
 * Sin sesión se conserva la regla pública: una sola organización manda, dos o
 * más devuelven la marca neutra para no enseñar el logo de un cliente en el
 * login de otro.
 *
 * Devuelve también el `organizationId` resuelto: el icono subido vive en el
 * volumen bajo ese id y la URL del `<link rel="icon">` tiene que distinguirlo,
 * o dos negocios con el mismo nombre comparten entrada en la caché del
 * navegador y uno ve el logo del vecino.
 */
export async function getBrandingContextForRequest(): Promise<{
  organizationId: string | null;
  branding: Branding;
}> {
  const session = await getSessionOrNull();
  return getBrandingContext(session?.organizationId);
}

/**
 * Guarda SOLO lo que llega: la marca se edita desde varios paneles (color,
 * icono, PDF) y un PUT parcial no debe pisar lo que otro guardó. `name`
 * omitido conserva el guardado; el nombre visible igual sale de Datos de
 * Empresa (ver `brandingWithBusinessName`).
 */
export async function saveBranding(
  organizationId: string,
  patch: Partial<Branding>
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  const current = normalizeBranding(
    (meta.branding as Partial<Branding> | undefined) ?? null
  );
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  );
  meta.branding = normalizeBranding({ ...current, ...defined });
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
}
