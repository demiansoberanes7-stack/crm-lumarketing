import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { privateAddress } from "@/server/waha/url";

function trustedHosts(): string[] {
  return (process.env.WEBHOOK_TRUSTED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Anti-SSRF para webhooks de salida.
 *
 * Un webhook es una URL que elegimos NOSOTROS apuntando a un servidor que
 * también elegimos nosotros, así que un propietario malicioso (o una
 * credencial filtrada) puede registrar `http://169.254.169.254/…` y hacer que
 * el CRM poste los datos del negocio dentro de la red del propio VPS.
 *
 * Reglas: solo http/https, sin credenciales embebidas, HTTPS obligatorio y
 * host público. La única excepción es `WEBHOOK_TRUSTED_HOSTS` (lista
 * coma-separada), el mismo patrón que `WAHA_TRUSTED_HOSTS`: un servicio
 * interno propio (n8n, Make self-hosted…) que sabes que es tuyo.
 */
export async function validateWebhookUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("La URL del webhook no es válida");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("El webhook solo puede usar http:// o https://");
  }
  if (url.username || url.password) {
    throw new Error("La URL no puede llevar credenciales; usa el secreto de firma");
  }
  if (url.hash) {
    throw new Error("La URL no puede llevar un fragmento #");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (trustedHosts().includes(hostname)) return url;

  if (url.protocol !== "https:") {
    throw new Error(
      "El webhook requiere HTTPS. Si es un servicio interno propio, añade su host a WEBHOOK_TRUSTED_HOSTS"
    );
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) {
    throw new Error("El webhook apunta a una IP privada, de loopback o de metadatos");
  }

  return url;
}
