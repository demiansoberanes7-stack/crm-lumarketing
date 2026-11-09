import { cache } from "react";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { resolveMembership } from "@/server/auth/on-signup";

export type SessionContext = {
  userId: string;
  organizationId: string;
  role: string;
};

export class UnauthorizedError extends Error {
  constructor(message = "No autenticado") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Sesión + organización activa para route handlers y server components.
 * Lanza UnauthorizedError si no hay sesión u organización.
 *
 * `cache` la deduplica por petición: varias llamadas del mismo request
 * comparten una sola lectura de sesión + membresía.
 */
export const requireSession = cache(async (): Promise<SessionContext> => {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();
  // La sesión puede crearse antes de que la membresía exista (registro
  // inicial) — la membresía en BD es la fuente de verdad de org + rol.
  const membership = await resolveMembership(session.user.id);
  if (!membership) {
    throw new UnauthorizedError("Sesión sin organización activa");
  }
  return {
    userId: session.user.id,
    organizationId: membership.organizationId,
    role: membership.role,
  };
});

/** Igual que requireSession pero devuelve null en vez de lanzar. */
export const getSessionOrNull = cache(async (): Promise<SessionContext | null> => {
  try {
    return await requireSession();
  } catch {
    return null;
  }
});

/**
 * Usuario de la sesión para el cascarón y las pantallas que lo saludan.
 *
 * `cache` de React lo memoriza por petición: el layout y una página que lo
 * necesiten comparten una sola lectura de sesión en vez de una por componente.
 */
export const getViewer = cache(async () => {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
});

/**
 * Sesión válida que todavía no pertenece a ningún negocio.
 *
 * Pasa en el alta pública de un cliente (crea el usuario; la organización se
 * crea en el paso siguiente) y si se borra la última membresía. Sin esta
 * distinción el usuario autenticado rebotaba `/login → /inbox → /login` para
 * siempre, porque `requireSession()` trata "sin org" igual que "sin sesión".
 */
export const getOrphanSession = cache(
  async (): Promise<{ userId: string; userName: string } | null> => {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return null;
    if (await resolveMembership(session.user.id)) return null;
    return { userId: session.user.id, userName: session.user.name };
  }
);
