/**
 * Business settings — datos de la empresa que aparecen en cotizaciones PDF.
 * Se guardan en `organization.metadata.businessSettings` (mismo patrón que Branding).
 */

export type BusinessSettings = {
  companyName: string;
  rfc: string;
  address: string;
  phone: string;
  email: string;
};

export const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  companyName: "",
  rfc: "",
  address: "",
  phone: "",
  email: "",
};

export function normalizeBusinessSettings(
  input: Partial<BusinessSettings> | null | undefined
): BusinessSettings {
  return {
    companyName: input?.companyName?.trim().slice(0, 200) ?? DEFAULT_BUSINESS_SETTINGS.companyName,
    rfc: input?.rfc?.trim().slice(0, 20) ?? DEFAULT_BUSINESS_SETTINGS.rfc,
    address: input?.address?.trim().slice(0, 500) ?? DEFAULT_BUSINESS_SETTINGS.address,
    phone: input?.phone?.trim().slice(0, 30) ?? DEFAULT_BUSINESS_SETTINGS.phone,
    email: input?.email?.trim().slice(0, 254) ?? DEFAULT_BUSINESS_SETTINGS.email,
  };
}
