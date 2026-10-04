import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Iniciales (máx 2) para el avatar de un contacto. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}

/* Paleta de los avatares del mockup de la landing (hsl(h 62% 52%)): tonos
   medios saturados, legibles con inicial blanca en los dos temas. */
const AVATAR_COLORS = [
  "bg-[#3985d1]", // azul
  "bg-[#d17139]", // terracota
  "bg-[#9e39d1]", // violeta
  "bg-[#30a657]", // verde
  "bg-[#ce3b6c]", // frambuesa
  "bg-[#b67c20]", // ámbar
  "bg-[#30a6a6]", // turquesa
  "bg-[#6954d4]", // índigo
] as const;

/** Color estable por contacto: hash simple del id/teléfono → misma clase siempre. */
export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

/** UUID v4. `crypto.randomUUID()` solo existe en secure contexts: en despliegues
 *  sin TLS (http:// en LAN) no está y revienta el componente que lo use. */
export function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function formatPhone(phone: string | null | undefined): string {
  // 003: contactos BSUID pueden no tener teléfono.
  return phone ? `+${phone}` : "Sin teléfono";
}
