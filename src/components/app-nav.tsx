"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, X } from "lucide-react";
import type { Branding } from "@/lib/branding";
import { cn, initials } from "@/lib/utils";
import { signOut } from "@/lib/auth/client";
import { NAV, NAV_FOOTER, isNavActive } from "@/config/nav";
import { useUnreadCount } from "@/components/use-unread-count";
import { BrandLogo } from "@/components/brand-mark";
import { PhotoLogo } from "@/components/photo-logo";
import { APP_VERSION, BUILD_COMMIT, versionLabel } from "@/lib/version";

/**
 * Un renglón del menú: texto semibold, esquinas medias y, activo, lavado del
 * acento. En modo rail (colapsado) queda solo el icono centrado; el `title`
 * hace de tooltip nativo.
 */
function navItemClass(active: boolean, collapsed: boolean) {
  return cn(
    "group flex items-center rounded-lg text-[13.5px] font-semibold transition-colors",
    collapsed
      ? "min-h-10 w-10 justify-center p-0"
      : "min-h-10 gap-[10px] px-2.5 py-2",
    active
      ? "bg-accent text-foreground"
      : "text-text-2 hover:bg-accent hover:text-foreground"
  );
}

export function AppNav({
  branding,
  logoUrl,
  userName,
  role,
  commit,
  open = false,
  collapsed = false,
  onClose,
}: {
  branding: Branding;
  /** Logo subido en Configuración → Negocio; manda sobre el trazo vectorial. */
  logoUrl?: string | null;
  userName: string;
  role: string;
  /**
   * Commit resuelto en el servidor. Gana al de build porque puede venir de la
   * plataforma cuando quien construyó no lo pasó como build-arg.
   */
  commit?: string;
  /** Solo aplica por debajo de `lg`: en escritorio el lateral es fijo. */
  open?: boolean;
  /** Solo aplica en escritorio: rail de solo iconos. */
  collapsed?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const unread = useUnreadCount();
  const [showVersion, setShowVersion] = useState(false);

  const sha = commit || BUILD_COMMIT;
  const showLabels = !collapsed;

  return (
    <aside
      // Móvil: cajón que se desliza desde la izquierda (siempre montado, así
      // la transición corre en ambos sentidos). Escritorio: rail o columna
      // fija según `collapsed`.
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col overflow-y-auto border-r bg-subtle pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] transition-[transform,visibility,width] duration-200",
        "lg:static lg:visible lg:z-auto lg:translate-x-0 lg:overflow-visible lg:transition-[width]",
        collapsed ? "lg:w-[64px] lg:px-3" : "lg:w-56 lg:px-3",
        open ? "visible w-[17rem] translate-x-0 px-3 shadow-pop" : "invisible w-[17rem] -translate-x-full px-3"
      )}
    >
      {/* Marca: el logo de la instancia; en rail colapsado solo el trazo. */}
      <div className={cn("mb-4 flex items-start gap-1.5 pt-0.5", showLabels ? "px-1" : "justify-center px-0")}>
        <button
          onClick={onClose}
          aria-label="Cerrar el menú"
          className="-ml-1 mt-0.5 rounded-md p-1.5 text-text-3 hover:bg-accent hover:text-foreground lg:hidden"
        >
          <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
        {showLabels ? (
          <div className="min-w-0">
            <BrandLogo branding={branding} logoUrl={logoUrl} />
          </div>
        ) : (
          <Link href="/dashboard" aria-label={branding.name} className="flex items-center">
            {logoUrl ? (
              <PhotoLogo src={logoUrl} alt="" className="h-8 w-8 rounded-lg" />
            ) : (
              <BrandLogo
                branding={branding}
                className="[&_span:last-child]:hidden [&_svg]:h-7 [&_svg]:w-7"
              />
            )}
          </Link>
        )}
      </div>

      <nav className={cn("flex flex-col gap-0.5", showLabels ? "" : "items-center")}>
        {[...NAV, ...NAV_FOOTER].map((item) => {
          const active = isNavActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={navItemClass(active, !showLabels)}
              title={showLabels ? undefined : item.label}
              aria-label={item.label}
            >
              <item.icon
                className={cn("h-[17px] w-[17px] shrink-0", active ? "text-brand" : "text-text-3")}
                strokeWidth={1.8}
              />
              {showLabels && <span className="flex-1 truncate">{item.label}</span>}
              {showLabels && item.badge && unread > 0 && (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-bold text-brand-fg">
                  {unread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className={cn("mt-1 flex items-center gap-2.5 rounded-lg py-2 hover:bg-accent", showLabels ? "px-2" : "justify-center px-0")}>
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-text",
            showLabels ? "h-8 w-8" : "h-8 w-8"
          )}
          title={userName}
        >
          {initials(userName)}
        </span>
        {showLabels && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{userName}</span>
            <span className="block truncate text-[11px] text-text-3">
              {role === "owner" ? "Propietario" : "Equipo"} · En línea
            </span>
          </span>
        )}
        {showLabels && (
          <button
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className="flex min-h-9 min-w-9 items-center justify-center rounded text-text-3 hover:text-foreground"
            onClick={async () => {
              await signOut();
              router.push("/login");
              router.refresh();
            }}
          >
            <LogOut className="h-4 w-4" strokeWidth={1.7} />
          </button>
        )}
      </div>

      {/* Versión del build: clic para ver el commit. Discreta y solo expandida. */}
      {showLabels && (
        <button
          className="mt-2 px-2.5 text-left font-mono text-[10.5px] tracking-[0.06em] text-text-2"
          title={
            sha
              ? `${branding.name} ${APP_VERSION}, construido del commit ${sha}`
              : `${branding.name} ${APP_VERSION}`
          }
          onClick={() => setShowVersion((v) => !v)}
        >
          {showVersion && sha ? `${versionLabel(sha)} · ${sha.slice(0, 7)}` : versionLabel(sha)}
        </button>
      )}
    </aside>
  );
}
