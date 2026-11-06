import {
  BarChart3,
  Bot,
  CalendarDays,
  DollarSign,
  FileText,
  FlaskConical,
  FolderKanban,
  Inbox,
  Kanban,
  LayoutDashboard,
  ListTodo,
  Mail,
  Package,
  Settings,
  Sparkles,
  Store,
  Truck,
  UserPlus,
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
  /**
   * 015 — Solo se muestra si esta instancia corre con `AGENDA`. No es un
   * adorno: sin la bandera, `/bookings` responde 404, así que el enlace sería
   * una puerta a la nada. La capa de servidor decide con `agendaEnabled()`.
   */
  agendaOnly?: boolean;
  /** Grupo del menú. El orden del array `NAV` sigue siendo el orden visible. */
  section?: NavSectionId;
};

/**
 * Grupos del lateral. `null` = sin rótulo (primer bloque y pie).
 *
 * La agrupación es deliberadamente corta: la referencia del proyecto muestra
 * seis entradas en total y la lectura depende de que el dueño reconozca el
 * arranque. Cuatro bloques con 2-6 renglones cada uno se escanea mejor que
 * quince renglones sueltos y no obliga a colapsar nada a diario.
 */
export type NavSectionId = "home" | "operacion" | "comercial" | "trabajo" | "inteligencia" | "sistema";

export type NavSection = {
  id: NavSectionId;
  label: string | null;
  items: NavItem[];
};

const SECTION_LABELS: Record<NavSectionId, string | null> = {
  home: null,
  operacion: "Operación",
  comercial: "Comercial",
  trabajo: "Trabajo",
  inteligencia: "Inteligencia",
  sistema: null,
};

const SECTION_ORDER: NavSectionId[] = [
  "home",
  "operacion",
  "comercial",
  "trabajo",
  "inteligencia",
  "sistema",
];

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, section: "home" },
  { href: "/inbox", label: "Bandeja", icon: Inbox, badge: true, section: "operacion" },
  { href: "/pipeline", label: "Pipeline", icon: Kanban, section: "operacion" },
  /**
   * «Agente de IA» ya existía como pantalla (`/agent`) pero solo se alcanzaba
   * desde la ficha del contacto en Bandeja: la pantalla de configuración del
   * agente no tenía puerta en el menú. Va en Operación porque es el mismo
   * trabajo —atender y automatizar la conversación—, no en Ajustes.
   */
  { href: "/agent", label: "Agente IA", icon: Bot, section: "operacion" },
  { href: "/contacts", label: "Contactos", icon: Users, section: "operacion" },
  { href: "/prospects", label: "Prospectos", icon: UserPlus, section: "operacion" },
  { href: "/quotes", label: "Cotizador", icon: FileText, section: "comercial" },
  { href: "/catalog", label: "Inventario", icon: Package, section: "comercial" },
  { href: "/branches", label: "Sucursales", icon: Store, section: "comercial" },
  { href: "/balance", label: "Balance", icon: DollarSign, section: "comercial" },
  { href: "/projects", label: "Proyectos", icon: FolderKanban, section: "trabajo" },
  { href: "/todo", label: "Pendientes", icon: ListTodo, section: "trabajo" },
  { href: "/broadcasts", label: "Envíos masivos", icon: Mail, section: "trabajo" },
  { href: "/suppliers", label: "Proveedores", icon: Truck, section: "trabajo" },
  /**
   * «Citas», no «Calendario»: la pantalla es la lista de compromisos y su
   * alta, no una rejilla de meses. «Calendario» sigue siendo el nombre de la
   * pestaña de Ajustes, que es donde se configura el horario.
   */
  { href: "/bookings", label: "Citas", icon: CalendarDays, agendaOnly: true, section: "operacion" },
  { href: "/lab", label: "Laboratorio", icon: FlaskConical, section: "inteligencia" },
  { href: "/inteligencia", label: "Inteligencia", icon: BarChart3, section: "inteligencia" },
];

/** Pie de la barra lateral: siempre visibles, fuera del grupo principal. */
export const NAV_FOOTER: NavItem[] = [
  { href: "/copiloto", label: "Copiloto", icon: Sparkles, section: "sistema" },
  { href: "/settings", label: "Ajustes", icon: Settings, section: "sistema" },
];

/**
 * El menú que le toca a ESTA instancia: las entradas de agenda solo existen
 * donde la agenda está encendida. Se filtra aquí y no en cada componente para
 * que la barra, los breadcrumbs y el ⌘K no discrepen nunca.
 */
export function navItemsFor(features: { agenda: boolean }): NavItem[] {
  return NAV.filter((item) => !item.agendaOnly || features.agenda);
}

/**
 * El mismo menú, agrupado para el lateral. Solo agrupa lo que ya existe: si
 * un enlace no está en `NAV`, no aparece; el filtro de `agendaOnly` se aplica
 * igual que en `navItemsFor` para que ambos caminos no discrepen.
 */
export function navSectionsFor(features: { agenda: boolean }): NavSection[] {
  const items = [...navItemsFor(features), ...NAV_FOOTER];
  return SECTION_ORDER.map((id) => ({
    id,
    label: SECTION_LABELS[id],
    items: items.filter((item) => item.section === id),
  })).filter((section) => section.items.length > 0);
}

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
