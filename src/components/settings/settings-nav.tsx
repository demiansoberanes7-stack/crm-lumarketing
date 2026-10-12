"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string };

// Núcleo de configuración: siempre visible en el nav lateral.
const CORE_TABS: Tab[] = [
  { href: "/settings/email", label: "Buzón" },
  { href: "/settings/branding", label: "Marca" },
  { href: "/settings/business", label: "Datos de Empresa" },
  { href: "/settings/agent", label: "Agente" },
  { href: "/settings/team", label: "Equipo" },
];

// Transporte alterno de WhatsApp (no tiene tarjeta en Conexiones, se queda en el nav).
const WAHA_TAB: Tab = { href: "/settings/waha", label: "WAHA" };

const CONNECTIONS_TAB: Tab = { href: "/settings/connections", label: "Conexiones" };
const MARKETING_TAB: Tab = { href: "/settings/marketing", label: "Marketing" };
const DATA_CLEANUP_TAB: Tab = { href: "/settings/data-cleanup", label: "Limpieza de Datos" };
const DIAGNOSTICS_TAB: Tab = { href: "/settings/diagnostics", label: "Diagnóstico" };
const WEBHOOKS_TAB: Tab = { href: "/settings/webhooks", label: "Webhooks" };

export function SettingsNav({ owner = false }: { owner?: boolean }) {
  const pathname = usePathname();
  const activeTabRef = useRef<HTMLAnchorElement | null>(null);
  const tabs = [
    ...(owner ? [CONNECTIONS_TAB] : []),
    ...(owner ? [MARKETING_TAB] : []),
    WAHA_TAB,
    ...CORE_TABS,
    // Webhooks es territorio del dueño: la API responde 403 a cualquier otro rol.
    ...(owner ? [WEBHOOKS_TAB] : []),
    ...(owner ? [DIAGNOSTICS_TAB] : []),
    ...(owner ? [DATA_CLEANUP_TAB] : []),
  ];

  useEffect(() => {
    if (window.matchMedia("(max-width: 639px)").matches) {
      activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [pathname]);

  return (
    <nav aria-label="Secciones de configuración" className="flex shrink-0 gap-1 overflow-x-auto scroll-smooth border-b p-2 sm:w-44 sm:flex-col sm:space-y-1 sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          ref={pathname.startsWith(t.href) ? activeTabRef : undefined}
          className={cn(
            "flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-sm px-3 text-[13.5px] font-semibold transition-colors",
            pathname.startsWith(t.href)
              ? "bg-brand-tint text-brand-text"
              : "text-text-2 hover:bg-accent hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
