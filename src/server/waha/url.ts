import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function privateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const value = ip.toLowerCase();
    return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value) || value.startsWith("::ffff:");
  }
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Private self-hosted WAHA is supported only for explicitly trusted deployment hosts. */
export async function validateWahaUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Usa la URL base de WAHA, sin ruta, credenciales ni parámetros");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const trusted = (process.env.WAHA_TRUSTED_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (trusted.includes(hostname)) return url;
  if (url.protocol !== "https:") throw new Error("WAHA requiere HTTPS o un host interno autorizado por el despliegue");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error("Host WAHA privado no autorizado en WAHA_TRUSTED_HOSTS");
  return url;
}
