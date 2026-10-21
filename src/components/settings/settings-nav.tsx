"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string };
type TabGroup = { label: string; tabs: Tab[] };

// Ajustes generales no relacionados con credenciales o con la configuración global de IA.
const CORE_TABS: Tab[] = [
  { href: "/settings/branding", label: "Marca" },
  { href: "/settings/business", label: "Datos de Empresa" },
  { href: "/settings/team", label: "Equipo" },
];

// Configuración global de IA: solo la administra el owner.
const AI_TABS: Tab[] = [
  { href: "/settings/copiloto", label: "Copiloto" },
  { href: "/settings/agent", label: "Agente" },
];

// Marketing, WAHA y Buzón no son pestañas del menú: se llega a ellas por las
// tarjetas de la página Conexiones (que enlaza a /settings/marketing, /settings/waha
// y /settings/email). El nav solo enseña el destino, no cada integración.
const CONNECTIONS_TAB: Tab = { href: "/settings/connections", label: "Conexiones" };

/**
 * El horario de atención vive en `/settings/calendar`, no en Conexiones: no es
 * una credencial, es una decisión del negocio. `bad4369` lo sacó del menú y
 * desde entonces la pantalla existía pero nadie podía abrirla. Solo con
 * `AGENDA`, porque sin la bandera la ruta responde 404.
 */
const CALENDAR_TAB: Tab = { href: "/settings/calendar", label: "Calendario" };

const WEBHOOKS_TAB: Tab = { href: "/settings/webhooks", label: "Webhooks" };
const DIAGNOSTICS_TAB: Tab = { href: "/settings/diagnostics", label: "Diagnóstico" };
const DATA_CLEANUP_TAB: Tab = { href: "/settings/data-cleanup", label: "Limpieza de Datos" };

export function SettingsNav({ owner = false, agenda = false }: { owner?: boolean; agenda?: boolean }) {
  const pathname = usePathname();
  const activeTabRef = useRef<HTMLAnchorElement | null>(null);

  // Conexiones es el destino único de integraciones (sus tarjetas enlazan a las
  // páginas de cada una); Ajustes agrupa lo demás (marca, equipo, IA, webhooks, mantenimiento).
  const groups: TabGroup[] = owner
    ? [
        {
          label: "Conexiones",
          tabs: [CONNECTIONS_TAB],
        },
        {
          label: "Ajustes",
          tabs: [
            ...AI_TABS,
            ...CORE_TABS,
            ...(agenda ? [CALENDAR_TAB] : []),
            WEBHOOKS_TAB,
            DIAGNOSTICS_TAB,
            DATA_CLEANUP_TAB,
          ],
        },
      ]
    : [{ label: "Ajustes", tabs: CORE_TABS }];

  useEffect(() => {
    if (window.matchMedia("(max-width: 639px)").matches) {
      activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [pathname]);

  return (
    <nav
      aria-label="Secciones de configuración"
      className="flex shrink-0 gap-1 overflow-x-auto scroll-smooth border-b p-2 sm:w-48 sm:flex-col sm:gap-4 sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3"
    >
      {groups.map((group) => (
        <div key={group.label} className="flex shrink-0 gap-1 sm:flex-col sm:gap-1">
          <p
            className="hidden shrink-0 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-3 sm:block"
            aria-hidden="true"
          >
            {group.label}
          </p>
          {group.tabs.map((t) => (
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
        </div>
      ))}
    </nav>
  );
}
