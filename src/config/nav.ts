import {
  BarChart3,
  DollarSign,
  FileText,
  FlaskConical,
  FolderKanban,
  Inbox,
  Kanban,
  LayoutDashboard,
  ListTodo,
  Package,
  Send,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Configuración única de navegación: la consumen la barra lateral, los
 * breadcrumbs de la cabecera y el paquete de comandos ⌘K. Agregar una ruta
 * aquí la hace aparecer en los tres lugares a la vez.
 */
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Muestra el contador de mensajes sin leer (solo Bandeja). */
  badge?: boolean;
};

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Bandeja", icon: Inbox, badge: true },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/contacts", label: "Contactos", icon: Users },
  { href: "/balance", label: "Balance", icon: DollarSign },
  { href: "/quotes", label: "Cotizador", icon: FileText },
  { href: "/catalog", label: "Inventario", icon: Package },
  { href: "/projects", label: "Proyectos", icon: FolderKanban },
  { href: "/broadcasts", label: "Envíos masivos", icon: Send },
  { href: "/suppliers", label: "Proveedores", icon: Truck },
  { href: "/todo", label: "Pendientes", icon: ListTodo },
  { href: "/lab", label: "Laboratorio", icon: FlaskConical },
  { href: "/inteligencia", label: "Inteligencia", icon: BarChart3 },
  { href: "/rentabilidad", label: "Rentabilidad", icon: TrendingUp },
  { href: "/estrategias", label: "Estrategias", icon: Target },
];

/** Pie de la barra lateral: siempre visibles, fuera del grupo principal. */
export const NAV_FOOTER: NavItem[] = [
  { href: "/copiloto", label: "Copiloto", icon: Sparkles },
  { href: "/settings", label: "Ajustes", icon: Settings },
];

/** Ruta activa: exacta o hija (`/settings/whatsapp` cuenta como `/settings`). */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Breadcrumbs a partir del pathname. La raíz usa la ruta coincidente del nav;
 * los segmentos hijos se capitalizan (`/settings/whatsapp` → Ajustes / Whatsapp).
 */
export function breadcrumbsFor(pathname: string): { label: string; href?: string }[] {
  const match =
    [...NAV, ...NAV_FOOTER].filter((item) => isNavActive(pathname, item.href)).sort(
      (a, b) => b.href.length - a.href.length
    )[0] ?? null;
  if (!match) return [{ label: "Inicio", href: "/dashboard" }];
  const crumbs: { label: string; href?: string }[] = [{ label: match.label, href: match.href }];
  const rest = pathname.slice(match.href.length).split("/").filter(Boolean);
  for (const segment of rest) {
    crumbs.push({
      label: segment.charAt(0).toUpperCase() + segment.slice(1).replaceAll("-", " "),
    });
  }
  return crumbs;
}
