"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string };

const TABS: Tab[] = [
  { href: "/settings/whatsapp", label: "WhatsApp · Zernio" },
  { href: "/settings/waha", label: "WAHA" },
  { href: "/settings/email", label: "Buzón" },
  { href: "/settings/branding", label: "Marca" },
  { href: "/settings/business", label: "Datos de Empresa" },
  { href: "/settings/agent", label: "Agente" },
  { href: "/settings/webhooks", label: "Webhooks" },
  { href: "/settings/team", label: "Equipo" },
];

const GOOGLE_TAB: Tab = { href: "/settings/google", label: "Google Calendar" };
const ADS_TAB: Tab = { href: "/settings/ads", label: "Anuncios" };
const MESSENGER_TAB: Tab = { href: "/settings/messenger", label: "Messenger" };
const INSTAGRAM_TAB: Tab = { href: "/settings/instagram", label: "Instagram" };
const TIKTOK_TAB: Tab = { href: "/settings/tiktok", label: "TikTok" };
const DATA_CLEANUP_TAB: Tab = { href: "/settings/data-cleanup", label: "Limpieza de Datos" };

export function SettingsNav({
  agenda = false,
  atribucion = false,
  messenger = false,
  instagram = false,
  tiktok = false,
  owner = false,
}: {
  agenda?: boolean;
  atribucion?: boolean;
  messenger?: boolean;
  instagram?: boolean;
  tiktok?: boolean;
  owner?: boolean;
}) {
  const pathname = usePathname();
  const tabs = [
    TABS[0]!,
    TABS[1]!,
    ...(messenger ? [MESSENGER_TAB] : []),
    ...(instagram ? [INSTAGRAM_TAB] : []),
    ...(tiktok ? [TIKTOK_TAB] : []),
    ...TABS.slice(2),
    ...(owner ? [{ href: "/settings/diagnostics", label: "Diagnóstico" }] : []),
    ...(agenda ? [GOOGLE_TAB] : []),
    ...(atribucion ? [ADS_TAB] : []),
    ...(owner ? [DATA_CLEANUP_TAB] : []),
  ];
  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-44 sm:flex-col sm:space-y-1 sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "block shrink-0 whitespace-nowrap rounded-sm px-3 py-2 text-[13.5px] font-semibold transition-colors",
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
