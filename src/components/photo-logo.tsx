"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * El logo que el dueño SUBE (Configuración → Negocio → "Subir logo"), tal como
 * se ve en la app. Si la imagen no carga (borraron el archivo, red mala)
 * desaparece y queda solo el nombre: nunca un ícono de imagen roto junto a la
 * marca.
 *
 * El caso delicado es el primer render: el 404 puede llegar ANTES de que React
 * ate el `onError`, y entonces el evento ya nadie lo escucha. Por eso, además
 * del handler, se revisa al montar si la imagen ya venía fallada.
 */
export function PhotoLogo({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el?.complete && el.naturalWidth === 0) setFailed(true);
  }, [src]);

  if (failed) return null;
  return (
    // Logo subido por el dueño: una URL que next/image no puede optimizar.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}
