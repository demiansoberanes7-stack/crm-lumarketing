import type { Branding } from "@/lib/branding";
import {
  BRAND_ACCENT,
  BRAND_ACCENT_ON_TILE,
  BRAND_MARK_BODY,
  BRAND_MARK_STROKE,
  BRAND_MARK_TAIL,
  isLumarkName,
} from "@/lib/brand";
import { faviconInitial } from "@/lib/favicon";
import { cn } from "@/lib/utils";
import { PhotoLogo } from "@/components/photo-logo";

/**
 * El trazo de la marca LUMARK: la "L" geométrica con remate dorado.
 * El cuerpo hereda `currentColor`; píntalo con `text-brand` (o blanco sobre el
 * mosaico) y el remate sigue siendo dorado.
 */
export function BrandMark({
  className,
  cyan = BRAND_ACCENT,
}: {
  className?: string;
  cyan?: string;
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
        stroke={cyan}
        strokeWidth={BRAND_MARK_STROKE}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Mosaico cuadrado con degradado del acento: es el favicon en grande. Con la
 * marca LUMARK lleva la "L"; con un nombre white-label, la inicial.
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
      {isLumarkName(branding.name) ? (
        <BrandMark className="h-[64%] w-[64%]" cyan={BRAND_ACCENT_ON_TILE} />
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
 * La marca completa: trazo + wordmark "LUMARK" en mayúsculas.
 * Una instancia rebautizada ve en su lugar el mosaico con la inicial y su nombre (white-label).
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
  const lumark = isLumarkName(branding.name);
  return (
    <span className={cn("flex min-w-0 items-center", lumark ? "gap-2" : "gap-2.5", className)}>
      {logoUrl ? (
        <PhotoLogo src={logoUrl} alt={branding.name} className={cn("w-auto", PHOTO_SIZE[size])} />
      ) : lumark ? (
        <BrandMark className={cn("shrink-0 text-brand", MARK_SIZE[size])} />
      ) : (
        <BrandTile branding={branding} className={TILE_SIZE[size]} />
      )}
      <span
        className={cn(
          lumark
            ? "font-[800] leading-none tracking-[-0.045em]"
            : "truncate font-[750] leading-none tracking-tight",
          lumark ? WORDMARK_SIZE[size] : size === "lg" ? "text-[26px]" : "text-[17px]"
        )}
      >
        {lumark ? "LUMARK" : branding.name}
      </span>
    </span>
  );
}
