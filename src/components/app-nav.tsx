"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import type { Branding } from "@/lib/branding";
import { cn, initials } from "@/lib/utils";
import { signOut } from "@/lib/auth/client";
import {
  isNavActive,
  navSectionsFor,
  type NavItem,
} from "@/config/nav";
import { BrandLogo } from "@/components/brand-mark";
import { APP_VERSION, BUILD_COMMIT, versionLabel } from "@/lib/version";

/**
 * Preferencia del lateral en escritorio. Vive en localStorage y no en cookie a
 * propósito: es una preferencia de dispositivo (un portátil estrecho quiere el
 * rail, un monitor ancho quiere etiquetas) y no debe viajar en el HTML del
 * servidor ni forzar un render distinto entre servidor y cliente.
 */
const COLLAPSE_KEY = "lumark.nav.collapsed";

/**
 * Un renglón del menú.
 *
 * `collapsed` solo aplica a escritorio: en el cajón móvil la etiqueta siempre
 * se ve, porque ahí no hay tooltip que la sustituya.
 */
function navItemClass(active: boolean, collapsed: boolean) {
  return cn(
    "group relative flex items-center rounded-lg text-[13.5px] font-semibold transition-colors duration-200",
    collapsed
      ? "min-h-10 gap-[10px] px-2.5 py-2 lg:min-h-11 lg:w-11 lg:justify-center lg:px-0"
      : "min-h-10 gap-[10px] px-2.5 py-2",
    active
      ? "bg-brand-tint text-foreground"
      : "text-text-2 hover:bg-accent hover:text-foreground"
  );
}

/**
 * Centro vertical del renglón dentro del `<aside>`.
 *
 * El globo dejó de ser hijo del enlace: el `nav` es la región con scroll y un
 * contenedor de scroll recorta todo lo que asoma de su caja, incluidos los
 * tooltips que salen a la derecha del rail.
 */
export function tooltipTop(
  item: { top: number; height: number },
  aside: { top: number }
): number {
  return item.top - aside.top + item.height / 2;
}

const AVATARS = [
  { id: "cat", emoji: "🐱", label: "Gato" },
  { id: "fox", emoji: "🦊", label: "Zorro" },
  { id: "lion", emoji: "🦁", label: "León" },
  { id: "dog", emoji: "🐶", label: "Perro" },
] as const;

type AvatarId = (typeof AVATARS)[number]["id"];

function avatarOption(value: string | null | undefined) {
  return AVATARS.find((option) => option.id === value) ?? null;
}

export function AppNav({
  branding,
  logoUrl,
  userName,
  avatar: initialAvatar,
  role,
  commit,
  agenda,
  unread,
  open = false,
  onClose,
}: {
  branding: Branding;
  /** Logo subido en Configuración → Negocio; manda sobre el trazo vectorial. */
  logoUrl?: string | null;
  userName: string;
  /** Icono elegido por el usuario; null = iniciales. */
  avatar?: string | null;
  role: string;
  /**
   * Commit resuelto en el servidor. Gana al de build porque puede venir de la
   * plataforma cuando quien construyó no lo pasó como build-arg.
   */
  commit?: string;
  /** Si `/bookings` existe en esta instancia. Sin bandera, el enlace daría 404. */
  agenda: boolean;
  /**
   * Mensajes sin leer del badge. Llega del cascarón, que es el único que se
   * suscribe a `/api/events`: cuando el rail abría su propia suscripción, cada
   * pestaña gastaba dos conexiones SSE y con dos pestañas se agotaba el tope
   * por negocio (el badge dejaba de actualizarse sin avisar).
   */
  unread: number | null;
  /** Solo aplica por debajo de `lg`: en escritorio el lateral es fijo. */
  open?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [showVersion, setShowVersion] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(initialAvatar ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState<AvatarId | "reset" | null>(null);
  const selectedAvatar = avatarOption(avatar);
  const asideRef = useRef<HTMLElement>(null);
  /**
   * Etiqueta del renglón bajo el cursor y su centro vertical. Vive en el
   * `<aside>`, no en el renglón, porque el `nav` ahora tiene scroll.
   */
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Se lee después de montar: en SSR no hay localStorage y arrancar colapsado
  // en el HTML parpadearía al hidratar.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // Modo privado con almacenamiento bloqueado: se queda expandido.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Sin persistencia; el cambio sigue valiendo para esta sesión.
      }
      return next;
    });
    setTip(null);
  }

  function showTip(target: HTMLElement, label: string) {
    if (!collapsed) return;
    const aside = asideRef.current;
    if (!aside) return;
    setTip({
      label,
      top: tooltipTop(target.getBoundingClientRect(), aside.getBoundingClientRect()),
    });
  }

  async function chooseAvatar(value: AvatarId | null) {
    setSavingAvatar(value ?? "reset");
    const res = await fetch("/api/settings/avatar", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ avatar: value }),
    }).catch(() => null);
    setSavingAvatar(null);
    if (!res?.ok) return;
    setAvatar(value);
    setPickerOpen(false);
  }

  async function logout() {
    if (!confirm("¿Cerrar sesión?")) return;
    await signOut();
    router.push("/login");
    router.refresh();
  }

  const sha = commit || BUILD_COMMIT;
  // El menú de ESTA instancia, agrupado: «Citas» solo existe donde la agenda
  // está encendida; sin la bandera, /bookings responde 404.
  const sections = useMemo(() => navSectionsFor({ agenda }), [agenda]);

  return (
    <aside
      ref={asideRef}
      // Móvil: cajón que se desliza desde la izquierda (siempre montado, así
      // la transición corre en ambos sentidos). Escritorio: columna con
      // etiquetas (248px) o rail de iconos (76px) según la preferencia.
      //
      // `lg:relative` y no `lg:static`: el globo del tooltip se posiciona
      // contra este borde para poder salir del rail sin que el scroll del
      // `nav` lo recorte.
      //
      // `lg:z-40` y no `lg:z-auto`: el `lg:translate-x-0` de abajo deja de ser
      // un adorno — un `transform` convierte al `<aside>` en contexto de
      // apilamiento, así que el `z-50` del globo solo vale DENTRO del rail. Fuera
      // de él, el rail competía con `z-auto` (0) contra la cabecera `sticky z-30`
      // que viene después en el DOM, y por eso el nombre del módulo salía
      // pintado por detrás. 40 queda por encima de la cabecera (30) y por
      // debajo de los diálogos de página (50) y del ⌘K (70), que sí deben tapar.
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col overflow-y-auto border-r bg-subtle pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] transition-[transform,visibility,width] duration-200",
        "lg:visible lg:relative lg:z-40 lg:w-[248px] lg:translate-x-0 lg:overflow-visible lg:px-3 lg:transition-[width]",
        collapsed && "lg:w-[76px]",
        open ? "visible w-[17rem] translate-x-0 px-3 shadow-pop" : "invisible w-[17rem] -translate-x-full px-3"
      )}
    >
      {/* Marca + plegado. En el cajón móvil: logo y nombre, sin plegado. */}
      <div className="mb-4 flex items-center gap-2 pt-0.5">
        <button
          onClick={onClose}
          aria-label="Cerrar el menú"
          className="-ml-1 rounded-md p-1.5 text-text-3 hover:bg-accent hover:text-foreground lg:hidden"
        >
          <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
        <Link
          href="/dashboard"
          aria-label={branding.name}
          className={cn(
            "flex min-w-0 items-center gap-2.5",
            collapsed && "lg:w-11 lg:justify-center"
          )}
        >
          {/* En el cajón móvil solo el nombre del negocio; la marca gráfica
              (logo subido o mosaico) se queda en el rail de escritorio, donde
              el plegado necesita un icono. */}
          <BrandLogo
            branding={branding}
            logoUrl={logoUrl}
            markClassName="hidden max-w-full min-w-0 lg:flex [&_img]:max-w-full"
            className={cn(
              "min-w-0 shrink",
              collapsed && "lg:[&_span:last-child]:hidden"
            )}
          />
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Mostrar etiquetas del menú" : "Ocultar el menú lateral"}
          aria-pressed={collapsed}
          title={collapsed ? "Mostrar etiquetas" : "Ocultar menú"}
          className="ml-auto hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-3 transition-colors hover:bg-accent hover:text-foreground lg:flex"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-[17px] w-[17px]" strokeWidth={1.8} />
          ) : (
            <PanelLeftClose className="h-[17px] w-[17px]" strokeWidth={1.8} />
          )}
        </button>
      </div>

      {/* Nav: en escritorio es la única región con scroll del lateral (ventanas
          cortas): así el logo, el avatar y la versión nunca quedan debajo del
          borde. Sin barra visible. */}
      <nav
        onScroll={() => setTip(null)}
        aria-label="Secciones"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto [scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden"
      >
        {sections.map((section) => (
          <div key={section.id} className="flex flex-col gap-0.5">
            {section.label ? (
              <p
                className={cn(
                  "px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3",
                  collapsed && "lg:hidden"
                )}
              >
                {section.label}
              </p>
            ) : null}
            {section.items.map((item) => (
              <NavRow
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
                unread={unread}
                onEnter={showTip}
                onLeave={() => setTip(null)}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* Usuario: avatar elegible + cuenta. */}
      <div
        className="group relative mt-1 flex items-center gap-2.5 rounded-lg py-2 hover:bg-accent lg:px-0"
        onMouseEnter={(e) => showTip(e.currentTarget, `${userName} · cuenta y avatar`)}
        onMouseLeave={() => setTip(null)}
      >
        <button
          type="button"
          aria-label={`Cuenta y avatar de ${userName}`}
          aria-haspopup="menu"
          aria-expanded={pickerOpen}
          title={`${userName} · cuenta y avatar`}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-lg font-bold text-brand-text",
            collapsed && "lg:mx-auto"
          )}
          onClick={() => setPickerOpen((v) => !v)}
        >
          {selectedAvatar ? (
            <span className="leading-none" aria-hidden>{selectedAvatar.emoji}</span>
          ) : (
            <span className="text-xs">{initials(userName)}</span>
          )}
        </button>
        <span className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
          <span className="block truncate text-[13px] font-semibold">{userName}</span>
          <span className="block truncate text-[11px] text-text-3">
            {role === "owner" ? "Propietario" : "Equipo"} · En línea
          </span>
        </span>

        {pickerOpen && (
          <>
            <button
              type="button"
              aria-label="Cerrar selector de avatar"
              tabIndex={-1}
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setPickerOpen(false)}
            />
            <div
              role="menu"
              aria-label="Elegir avatar"
              className="absolute bottom-full left-0 z-50 mb-2 w-60 rounded-xl border bg-popover p-3 shadow-pop"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Tu avatar</p>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {AVATARS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={avatar === option.id}
                    aria-label={option.label}
                    title={option.label}
                    disabled={savingAvatar !== null}
                    onClick={() => void chooseAvatar(option.id)}
                    className={cn(
                      "flex h-11 items-center justify-center rounded-lg border text-xl transition-colors",
                      avatar === option.id
                        ? "border-brand-text bg-brand-tint"
                        : "border-border hover:bg-accent"
                    )}
                  >
                    {savingAvatar === option.id ? "…" : option.emoji}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={savingAvatar !== null}
                onClick={() => void chooseAvatar(null)}
                className="mt-2 w-full rounded-lg border border-border px-2 py-1.5 text-xs font-semibold text-text-2 hover:bg-accent disabled:opacity-60"
              >
                {savingAvatar === "reset" ? "Guardando…" : "Usar iniciales"}
              </button>
              <div className="my-2 h-px bg-border" />
              <p className="truncate text-xs font-semibold">{userName}</p>
              <p className="truncate text-[11px] text-text-3">
                {role === "owner" ? "Propietario" : "Equipo"}
              </p>
              <button
                type="button"
                onClick={() => void logout()}
                className="mt-2 w-full rounded-lg border border-border px-2 py-1.5 text-xs font-semibold hover:bg-accent"
              >
                Cerrar sesión
              </button>
            </div>
          </>
        )}
      </div>

      {/* Versión del build: discreta, clic para ver el commit. */}
      <button
        className={cn(
          "mt-2 hidden text-center font-mono text-[10px] tracking-[0.06em] text-text-2 lg:block",
          collapsed && "lg:mt-1"
        )}
        title={
          sha
            ? `${branding.name} ${APP_VERSION}, construido del commit ${sha}`
            : `${branding.name} ${APP_VERSION}`
        }
        onClick={() => setShowVersion((v) => !v)}
      >
        {showVersion && sha ? versionLabel(sha) : APP_VERSION}
      </button>

      {/*
        Globo del renglón bajo el cursor, solo con el menú plegado. Es hijo del
        `<aside>` y no del enlace porque el `nav` es contenedor de scroll y
        recortaría lo que asoma por su derecha.
      */}
      {tip && (
        <span
          role="tooltip"
          style={{ top: tip.top }}
          className="pointer-events-none absolute left-full z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs font-medium text-foreground shadow-md lg:block"
        >
          {tip.label}
        </span>
      )}
    </aside>
  );
}

/** Renglón del menú: icono, etiqueta plegable y contador de no leídos. */
function NavRow({
  item,
  pathname,
  collapsed,
  unread,
  onEnter,
  onLeave,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  unread: number | null;
  onEnter: (target: HTMLElement, label: string) => void;
  onLeave: () => void;
}) {
  const active = isNavActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      className={navItemClass(active, collapsed)}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      onMouseEnter={(e) => onEnter(e.currentTarget, item.label)}
      onMouseLeave={onLeave}
    >
      <item.icon
        className={cn(
          "h-[18px] w-[18px] shrink-0",
          active ? "text-brand-text" : "text-text-3 group-hover:text-text-2"
        )}
        strokeWidth={1.8}
      />
      <span className={cn("flex-1 truncate", collapsed && "lg:hidden")}>{item.label}</span>
      {item.badge && unread ? (
        <span
          className={cn(
            "flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-brand-fg",
            collapsed
              ? "lg:absolute lg:right-0.5 lg:top-0.5 lg:h-3.5 lg:min-w-3.5 lg:px-0.5 lg:text-[9px]"
              : "ml-auto"
          )}
        >
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
