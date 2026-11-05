"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

/**
 * Miniatura de la foto congelada en una partida de cotización.
 *
 * Es la misma imagen que el PDF imprime, así que el compositor y el detalle
 * muestran lo que el cliente va a recibir. Sin foto no hay cajón; si el archivo
 * ya no está en disco, el cuadro lo dice en vez de quedarse en blanco.
 */
export function ItemPhoto({ url, name }: { url: string; name: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div
        title="Foto no disponible"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded border bg-subtle text-text-3"
      >
        <ImageOff className="h-4 w-4" aria-hidden />
      </div>
    );
  }
  return (
    <div className="h-11 w-11 shrink-0 overflow-hidden rounded border bg-subtle">
      {/* eslint-disable-next-line @next/next/no-img-element -- la foto vive en MEDIA_DIR con dimensiones arbitrarias y el negocio la sube ya comprimida; el optimizador la recodificaría en cada petición. */}
      <img
        src={url}
        alt={name}
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
      />
    </div>
  );
}
