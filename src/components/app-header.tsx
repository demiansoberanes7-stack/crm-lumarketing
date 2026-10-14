"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Menu, Search } from "lucide-react";
import type { Branding } from "@/lib/branding";
import type { ThemePreference } from "@/lib/theme";
import { breadcrumbsFor } from "@/config/nav";
import { BrandLogo } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

/**
 * Cabecera: a la izquierda la marca (móvil) o migas (escritorio); a la
 * derecha el buscador ⌘K, la campana de la Bandeja y el tema. En móvil la
 * hamburguesa abre el cajón.
 */
export function AppHeader({
  branding,
  logoUrl,
  theme,
  unread,
  onOpenDrawer,
  onOpenSearch,
}: {
  branding: Branding;
  logoUrl?: string | null;
  theme: ThemePreference;
  unread: number;
  /** Abre el cajón en móvil. */
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
}) {
  const pathname = usePathname();
  const crumbs = breadcrumbsFor(pathname);

  return (
    <header className="header-surface sticky top-0 z-30 flex h-12 shrink-0 items-center gap-1 border-b px-2 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:h-14 sm:px-3">
      {/* Móvil: hamburguesa + marca. */}
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label="Abrir el menú"
        className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-text-2 hover:bg-accent hover:text-foreground lg:hidden"
      >
        <Menu className="h-5 w-5" strokeWidth={1.8} />
      </button>

      <div className="min-w-0 flex-1 lg:px-2">
        <div className="lg:hidden">
          <BrandLogo branding={branding} logoUrl={logoUrl} />
        </div>
        <nav aria-label="Migas de pan" className="hidden min-w-0 items-center gap-1.5 lg:flex">
          {crumbs.map((crumb, i) => (
            <span key={crumb.label} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <span className="text-text-3" aria-hidden>/</span>}
              {crumb.href && i < crumbs.length - 1 ? (
                <Link
                  href={crumb.href}
                  className="truncate text-sm text-text-2 hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate text-sm font-medium text-foreground">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={onOpenSearch}
          className="hidden min-h-9 items-center gap-2 rounded-lg border border-border bg-subtle px-2.5 text-sm text-text-3 transition-colors hover:border-border-strong hover:text-foreground md:flex"
          aria-label="Buscar sección (⌘K)"
        >
          <Search className="h-4 w-4" strokeWidth={1.8} />
          <span>Buscar</span>
          <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">⌘K</kbd>
        </button>
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Buscar sección (⌘K)"
          className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-text-2 hover:bg-accent hover:text-foreground md:hidden"
        >
          <Search className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
        <Link
          href="/inbox"
          aria-label={unread > 0 ? `Bandeja: ${unread} sin leer` : "Bandeja"}
          className="relative flex min-h-9 min-w-9 items-center justify-center rounded-lg text-text-2 hover:bg-accent hover:text-foreground"
        >
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.8} />
          {unread > 0 && (
            <span
              className={cn(
                "absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-brand-fg"
              )}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
        <ThemeToggle initial={theme} className="min-h-9 min-w-9 rounded-lg hover:bg-accent" />
      </div>
    </header>
  );
}
