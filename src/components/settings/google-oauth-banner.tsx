"use client";

import { useEffect } from "react";

/**
 * 015 · B2 — Aviso del resultado de la autorización de Google.
 *
 * El texto lo calcula la página a partir de `searchParams` (server component):
 * así se explica también el fallo que ocurre ANTES de poder leer el `state` —un
 * enlace caducado o de otra persona—, que es justo el que un componente cliente
 * no podría atribuir a ningún calendario.
 *
 * El efecto solo limpia la URL: un `?connected=1` que se queda colgando hace
 * que un recargo, o la misma dirección guardada en favoritos, vuelva a anunciar
 * una conexión que pudo no llegar a pasar.
 */
export function GoogleOAuthBanner({
  kind,
  text,
}: {
  kind: "ok" | "error";
  text: string;
}) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("connected") && !params.has("error")) return;
    params.delete("connected");
    params.delete("error");
    params.delete("scope");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  return (
    <p
      role="status"
      className={
        kind === "ok"
          ? "rounded-sm border border-success-soft bg-success-tint px-3 py-2 text-sm text-success-text"
          : "rounded-sm border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text"
      }
    >
      {text}
    </p>
  );
}
