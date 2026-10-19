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
 */
export async function requireSession(): Promise<SessionContext> {
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
}

/** Igual que requireSession pero devuelve null en vez de lanzar. */
export async function getSessionOrNull(): Promise<SessionContext | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}

/**
 * Sesión válida que todavía no pertenece a ningún negocio.
 *
 * Pasa en el alta pública de un cliente (crea el usuario; la organización se
 * crea en el paso siguiente) y si se borra la última membresía. Sin esta
 * distinción el usuario autenticado rebotaba `/login → /inbox → /login` para
 * siempre, porque `requireSession()` trata "sin org" igual que "sin sesión".
 */
export async function getOrphanSession(): Promise<{ userId: string; userName: string } | null> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  if (await resolveMembership(session.user.id)) return null;
  return { userId: session.user.id, userName: session.user.name };
}
