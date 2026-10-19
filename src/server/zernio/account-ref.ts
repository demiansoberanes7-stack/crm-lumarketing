/**
 * El transporte enruta sus eventos por una referencia de cuenta (`account.id`,
 * no el id del perfil) y esa columna NO es única: dos negocios de una misma
 * instancia pueden acabar con la misma referencia, y entonces el evento no tiene
 * dueño demostrable.
 *
 * Tomar la primera fila sin mirar repartiría conversaciones entre tenants. Si
 * hay más de una organización en juego se devuelve `null`, que hace que el
 * webhook se descarte y se note en los logs en vez de contaminar un CRM ajeno.
 */
export function pickUnambiguousOrgRow<T extends { organizationId: string }>(
  rows: T[],
  source: string,
  ref: string
): T | null {
  const first = rows[0];
  if (!first) return null;
  if (rows.some((r) => r.organizationId !== first.organizationId)) {
    console.warn(
      `[${source}] Referencia de cuenta «${ref}» registrada por varios negocios; evento sin enrutar`
    );
    return null;
  }
  return first;
}
