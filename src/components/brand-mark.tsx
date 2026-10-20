import Image from "next/image";
import type { Branding } from "@/lib/branding";
import {
  BRAND_ACCENT,
  BRAND_ACCENT_ON_TILE,
  BRAND_MARK_BODY,
  BRAND_MARK_STROKE,
  BRAND_MARK_TAIL,
  isZorroTechName,
} from "@/lib/brand";
import { faviconInitial } from "@/lib/favicon";
import { cn } from "@/lib/utils";
import { PhotoLogo } from "@/components/photo-logo";

/**
 * El trazo de la marca Zorro Tech: la "Z" geométrica con remate lima.
 * El cuerpo hereda `currentColor`; píntalo con `text-brand` (o blanco sobre el
 * mosaico) y el remate sigue siendo lima.
 */
export function BrandMark({
  className,
  accent = BRAND_ACCENT,
}: {
  className?: string;
  accent?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d={BRAND_MARK_BODY}
        stroke="currentColor"
        strokeWidth={BRAND_MARK_STROKE}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d={BRAND_MARK_TAIL}
        stroke={accent}
        strokeWidth={BRAND_MARK_STROKE}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Mosaico cuadrado con degradado del acento: es el favicon en grande. Con la
 * marca Zorro Tech lleva la "Z"; con un nombre white-label, la inicial.
 */
export function BrandTile({
  branding,
  className,
}: {
  branding: Pick<Branding, "name">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "brand-tile flex shrink-0 items-center justify-center text-brand-fg",
        className
      )}
      aria-hidden
    >
      {isZorroTechName(branding.name) ? (
        <BrandMark className="h-[64%] w-[64%]" accent={BRAND_ACCENT_ON_TILE} />
      ) : (
        <span className="font-bold leading-none">{faviconInitial(branding.name)}</span>
      )}
    </span>
  );
}

const WORDMARK_SIZE = {
  md: "text-[21px]",
  lg: "text-[30px]",
} as const;

const MARK_SIZE = {
  md: "h-[24px] w-[24px]",
  lg: "h-[34px] w-[34px]",
} as const;

const TILE_SIZE = {
  md: "h-[30px] w-[30px] rounded-[9px] text-[15px]",
  lg: "h-[44px] w-[44px] rounded-[13px] text-[22px]",
} as const;

/** Altura del logo subido: entra en la barra lateral sin empujar el wordmark. */
const PHOTO_SIZE = {
  md: "h-[26px] max-w-[132px]",
  lg: "h-[36px] max-w-[200px]",
} as const;

/**
 * La marca completa: trazo + nombre en el estilo de la marca madre.
 * Una instancia rebautizada ve en su lugar el mosaico con la inicial y su
 * nombre (white-label).
 *
 * Si el negocio SUBIÓ un logo (Configuración → Negocio), esa foto es la que se
 * dibuja en la barra lateral y en la cabecera móvil; el trazo vectorial queda
 * como alternativa cuando no hay imagen.
 */
export function BrandLogo({
  branding,
  size = "md",
  className,
  logoUrl,
}: {
  branding: Pick<Branding, "name">;
  size?: keyof typeof WORDMARK_SIZE;
  className?: string;
  logoUrl?: string | null;
}) {
  const marcaMadre = isZorroTechName(branding.name);
  return (
    <span className={cn("flex min-w-0 items-center", marcaMadre ? "gap-2" : "gap-2.5", className)}>
      {logoUrl ? (
        <PhotoLogo src={logoUrl} alt={branding.name} className={cn("w-auto", PHOTO_SIZE[size])} />
      ) : marcaMadre ? (
        <Image
          src="/brand/zorro-tech.png"
          alt=""
          width={64}
          height={64}
          className={cn("shrink-0 rounded-[24%] object-cover", MARK_SIZE[size])}
        />
      ) : (
        <BrandTile branding={branding} className={TILE_SIZE[size]} />
      )}
      <span
        className={cn(
          // Siempre contraste con el fondo del tema: blanco sobre negro,
          // negro sobre blanco (el color heredado del botón era gris).
          "text-foreground",
          marcaMadre
            ? "font-[800] leading-none tracking-[-0.045em]"
            : "truncate font-[750] leading-none tracking-tight",
          marcaMadre ? WORDMARK_SIZE[size] : size === "lg" ? "text-[26px]" : "text-[17px]"
        )}
      >
        {branding.name}
      </span>
    </span>
  );
}
