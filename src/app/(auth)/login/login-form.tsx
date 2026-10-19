"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth/client";

/**
 * Inicio de sesión de la instancia.
 *
 * Solo cambia la CAPA VISUAL (tarjeta y campos de la plantilla oficial). La
 * autenticación es la misma de siempre: `signIn.email` de Better Auth, con su
 * manejo de errores (429 = rate limit) y el redirect a /inbox al entrar.
 *
 * Lo que decide si conviene ofrecer el alta es del servidor (`getSignupState`),
 * así que llega por props: `initial` = instancia vacía, `business` = registro
 * abierto con negocios ya creados, `closed` = no se puede crear cuenta.
 */
export type SignupOffer = "initial" | "business" | "closed";

const CTA: Record<Exclude<SignupOffer, "closed">, { question: string; action: string }> = {
  initial: { question: "¿Primera vez aquí?", action: "Crear la cuenta inicial" },
  business: { question: "¿Nuevo negocio?", action: "Crea tu cuenta y tu espacio" },
};

export function LoginForm({ signup }: { signup: SignupOffer }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await signIn.email({ email, password });
    setLoading(false);
    if (err) {
      const code = (err as { code?: string }).code;
      setError(
        err.status === 429
          ? "Demasiados intentos. Espera unos minutos."
          : err.status === 403 || code === "EMAIL_NOT_VERIFIED"
            ? "Tu correo aún no está verificado. Revisa tu bandeja de entrada."
            : "Correo o contraseña incorrectos."
      );
      return;
    }
    const callbackURL = new URLSearchParams(window.location.search).get("callbackURL");
    const safeCallback = callbackURL && new URL(callbackURL, window.location.origin).origin === window.location.origin
      ? callbackURL
      : "/inbox";
    router.push(safeCallback);
    router.refresh();
  }

  const offer = signup === "closed" ? null : CTA[signup];

  return (
    <div className="zx-card">
      <h1 className="zx-title">Iniciar sesión</h1>
      <form onSubmit={onSubmit} className="zx-form">
        <div className="zx-field">
          <label htmlFor="email">Correo</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="zx-field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="zx-submit" type="submit" disabled={loading}>
          {loading ? "Entrando…" : "Entrar"}
        </button>
        {error && (
          <p className="zx-error" role="alert">
            {error}
          </p>
        )}
      </form>
      <p className="zx-signup">
        {offer ? (
          <>
            {offer.question}{" "}
            <Link href="/register">{offer.action}</Link>
          </>
        ) : (
          "El registro está cerrado en esta instancia: pide acceso al propietario."
        )}
      </p>
    </div>
  );
}
