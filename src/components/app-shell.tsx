"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { Branding } from "@/lib/branding";
import type { ThemePreference } from "@/lib/theme";
import { AppNav } from "@/components/app-nav";
import { AppHeader } from "@/components/app-header";
import { CommandPalette, useCommandPaletteShortcut } from "@/components/command-palette";
import { useUnreadCount } from "@/components/use-unread-count";

/**
 * Cascaron de la app:
 *
 * - Escritorio (lg+): rail fijo de solo iconos medianos con tooltip al hover.
 * - Móvil/tableta: el lateral sale como cajón sobre un velo; la cabecera
 *   lleva hamburguesa y marca.
 *
 * La altura usa `100dvh` (no `100vh`) porque en el navegador móvil la barra de
 * direcciones se encoge al hacer scroll: con `vh` el compositor de la Bandeja
 * queda debajo del borde visible.
 */
export function AppShell({
  branding,
  logoUrl,
  userName,
  avatar,
  role,
  theme,
  commit,
  children,
}: {
  branding: Branding;
  /** Logo subido en Configuración → Negocio (foto, no el trazo vectorial). */
  logoUrl?: string | null;
  userName: string;
  /** Icono de avatar elegido (cat/fox/lion/dog) o null para iniciales. */
  avatar?: string | null;
  role: string;
  theme: ThemePreference;
  /** Commit resuelto en el servidor (build-arg o variable de la plataforma). */
  commit?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [visibleHeight, setVisibleHeight] = useState<string | null>(null);
  const unread = useUnreadCount();

  // El teclado virtual no siempre modifica 100dvh (especialmente iOS Safari).
  // Sincronizar el shell con el viewport visual mantiene el composer visible.
  useEffect(() => {
    const visualViewport = window.visualViewport;
    const updateHeight = () => {
      const height = visualViewport?.height ?? window.innerHeight;
      setVisibleHeight(`${Math.round(height)}px`);
    };
    updateHeight();
    visualViewport?.addEventListener("resize", updateHeight);
    window.addEventListener("resize", updateHeight);
    return () => {
      visualViewport?.removeEventListener("resize", updateHeight);
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  useCommandPaletteShortcut(useCallback(() => setSearchOpen((o) => !o), []));

  // Navegar = cerrar el cajón. Sin esto, tocar "Pipeline" deja el velo encima
  // de la pantalla recién cargada.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen && !searchOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNavOpen(false);
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen, searchOpen]);

  return (
    <div
      className="flex h-dvh overflow-hidden bg-background"
      style={visibleHeight ? { height: visibleHeight } : undefined}
    >
      {navOpen && (
        <button
          aria-label="Cerrar el menú"
          tabIndex={-1}
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-overlay lg:hidden"
        />
      )}

      <AppNav
        branding={branding}
        logoUrl={logoUrl}
        commit={commit}
        userName={userName}
        avatar={avatar}
        role={role}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          branding={branding}
          logoUrl={logoUrl}
          theme={theme}
          unread={unread}
          onOpenDrawer={() => setNavOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
        />

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
