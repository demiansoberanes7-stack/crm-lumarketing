import { graphRequest, MetaApiError } from "@/lib/meta/client";

export type ConnectionCheck =
  | {
      ok: true;
      displayPhoneNumber: string;
      verifiedName: string | null;
      wabaStatus?: string;
      accountMode?: string;
    }
  | { ok: false; code: "invalid_token" | "meta_unavailable" | "meta_error" | "waba_mismatch"; message: string };

/**
 * Valida token↔número contra la Graph API SIN persistir nada (FR-040):
 * un GET del número con el token debe devolver su display_phone_number.
 * Opcionalmente valida que el PhoneNumberID pertenezca a la WABA indicada.
 */
export async function testConnection(
  phoneNumberId: string,
  token: string,
  wabaId?: string
): Promise<ConnectionCheck> {
  try {
    const res = await graphRequest<{
      display_phone_number?: string;
      verified_name?: string;
      id: string;
      waba_business_manager_id?: string;
      quality_rating?: string;
    }>(`${phoneNumberId}?fields=display_phone_number,verified_name,waba_business_manager_id,quality_rating`, {
      token,
    });
    if (!res.display_phone_number) {
      return {
        ok: false,
        code: "meta_error",
        message:
          "Meta no devolvió el número: verifica que el Phone Number ID sea correcto",
      };
    }
    if (wabaId && res.waba_business_manager_id && res.waba_business_manager_id !== wabaId) {
      return {
        ok: false,
        code: "waba_mismatch",
        message: `El número pertenece a la WABA ${res.waba_business_manager_id}, no a ${wabaId}. Verifica el WABA ID.`,
      };
    }
    return {
      ok: true,
      displayPhoneNumber: res.display_phone_number,
      verifiedName: res.verified_name ?? null,
      wabaStatus: res.quality_rating ?? undefined,
    };
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        return {
          ok: false,
          code: "invalid_token",
          message:
            "El token no es válido o expiró. Verifica que corresponde a este número (modo directo: token de usuario del sistema; modo agencia: token entregado por tu backend).",
        };
      }
      if (err.status === 0 || err.status >= 500) {
        return {
          ok: false,
          code: "meta_unavailable",
          message: "Meta no está disponible en este momento; intenta de nuevo",
        };
      }
      return { ok: false, code: "meta_error", message: err.message };
    }
    throw err;
  }
}

/**
 * Verifica que la app esté suscrita a la WABA y retorna su estado.
 * Best-effort: en modo agencia el override lo configura el backend.
 */
export async function getWabaSubscriptionStatus(
  wabaId: string,
  token: string
): Promise<{ subscribed?: boolean; status?: string } | null> {
  try {
    const res = await graphRequest<{
      name?: string;
      status?: string;
      business_manager_id?: string;
    }>(`${wabaId}?fields=name,status,business_manager_id`, {
      token,
    });
    return { status: res.status };
  } catch {
    return null;
  }
}

/**
 * Suscribe la app a la WABA tras guardar (necesario para recibir webhooks en
 * modo directo). Best-effort: en modo agencia el override lo configura el
 * backend de la agencia y esta llamada puede no aplicar.
 */
export async function subscribeAppToWaba(
  wabaId: string,
  token: string,
  organizationId?: string
): Promise<void> {
  try {
    await graphRequest(`${wabaId}/subscribed_apps`, {
      method: "POST",
      token,
    });
  } catch (err) {
    // Expected to fail in agency mode — do not surface error to user.
    if (organizationId) {
      const { recordDiagnostic } = await import("@/server/diagnostics/logger");
      await recordDiagnostic({ organizationId, source: "meta", code: "subscription_failed", severity: "warning", error: err });
    }
  }
}
