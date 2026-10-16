/**
 * UTMs del origen del tráfico.
 *
 * Hoy la única URL real que entra al CRM es la que Meta manda en
 * `referral.source_url` (la URL del anuncio que originó el clic). Si ese
 * anuncio apunta a una landing con `utm_*`, se quedan aquí; si no los trae,
 * se devuelven campos vacíos — no se rellena nada a mano.
 */

export type UtmParams = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
};

export const EMPTY_UTMS: UtmParams = {
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
};

/** `null` si la cadena no es una URL parseable (Meta manda basura a veces). */
export function parseUtmParams(rawUrl: string | null | undefined): UtmParams {
  if (!rawUrl) return EMPTY_UTMS;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return EMPTY_UTMS;
  }
  const get = (key: string) => {
    const value = url.searchParams.get(key);
    return value && value.trim() ? value.trim().slice(0, 255) : null;
  };
  return {
    utmSource: get("utm_source"),
    utmMedium: get("utm_medium"),
    utmCampaign: get("utm_campaign"),
    utmContent: get("utm_content"),
    utmTerm: get("utm_term"),
  };
}

/** ¿La cadena trae algún `utm_*`? Para decidir si el toque los merece. */
export function hasUtm(utm: UtmParams): boolean {
  return Boolean(
    utm.utmSource || utm.utmMedium || utm.utmCampaign || utm.utmContent || utm.utmTerm
  );
}
