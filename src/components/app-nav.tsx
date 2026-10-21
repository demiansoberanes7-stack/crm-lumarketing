"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { Branding } from "@/lib/branding";
import { cn, initials } from "@/lib/utils";
import { signOut } from "@/lib/auth/client";
import { NAV_FOOTER, isNavActive, navItemsFor } from "@/config/nav";
import { useUnreadCount } from "@/components/use-unread-count";
import { BrandLogo } from "@/components/brand-mark";
import { PhotoLogo } from "@/components/photo-logo";
import { APP_VERSION, BUILD_COMMIT, versionLabel } from "@/lib/version";

/**
 * Un renglón del menú. En escritorio (lg+) siempre es solo icono mediano
 * con tooltip CSS al hover; en móvil (drawer) muestra icono + etiqueta.
 */
function navItemClass(active: boolean, showLabel: boolean) {
  return cn(
    "group relative flex items-center rounded-lg text-[13.5px] font-semibold transition-colors",
    showLabel
      ? "min-h-10 gap-[10px] px-2.5 py-2"
      : "min-h-11 w-11 justify-center p-0",
    active
      ? "bg-accent text-foreground"
      : "text-text-2 hover:bg-accent hover:text-foreground"
  );
}

/** Tooltip CSS: aparece al hover del Link padre (group). Solo en modo icono. */
function NavTooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100 lg:group-hover:opacity-100"
    >
      {label}
    </span>
  );
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
  /** Solo aplica por debajo de `lg`: en escritorio el lateral es fijo. */
  open?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const unread = useUnreadCount();
  const [showVersion, setShowVersion] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(initialAvatar ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState<AvatarId | "reset" | null>(null);
  const selectedAvatar = avatarOption(avatar);

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
  // El menú de ESTA instancia: «Calendario» solo existe donde la agenda está
  // encendida; sin la bandera, /bookings responde 404.
  const renderedNav = useMemo(() => [...navItemsFor({ agenda }), ...NAV_FOOTER], [agenda]);

  return (
    <aside
      // Móvil: cajón que se desliza desde la izquierda (siempre montado, así
      // la transición corre en ambos sentidos). Escritorio: rail fijo de solo
      // iconos medianos con tooltip al hover.
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col overflow-y-auto border-r bg-subtle pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] transition-[transform,visibility,width] duration-200",
        "lg:static lg:visible lg:z-auto lg:w-[72px] lg:translate-x-0 lg:overflow-visible lg:px-3 lg:transition-[width]",
        open ? "visible w-[17rem] translate-x-0 px-3 shadow-pop" : "invisible w-[17rem] -translate-x-full px-3"
      )}
    >
      {/* Marca: en escritorio solo el logo centrado; en móvil drawer, completo. */}
      <div className="mb-4 flex items-start gap-1.5 pt-0.5 lg:justify-center lg:px-0">
        <button
          onClick={onClose}
          aria-label="Cerrar el menú"
          className="-ml-1 mt-0.5 rounded-md p-1.5 text-text-3 hover:bg-accent hover:text-foreground lg:hidden"
        >
          <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
        {/* Drawer móvil: nombre + logo. Escritorio: solo logo. */}
        <div className="min-w-0 lg:hidden">
          <BrandLogo branding={branding} logoUrl={logoUrl} />
        </div>
        <Link href="/dashboard" aria-label={branding.name} className="hidden items-center lg:flex">
          {logoUrl ? (
            <PhotoLogo src={logoUrl} alt="" className="h-9 w-9 rounded-lg" />
          ) : (
            <BrandLogo
              branding={branding}
              className="[&_span:last-child]:hidden [&_svg]:h-8 [&_svg]:w-8"
            />
          )}
        </Link>
      </div>

      {/* Nav: en escritorio solo iconos con tooltip; en móvil drawer, con label. */}
      <nav className="flex flex-col gap-0.5 lg:items-center">
        {renderedNav.map((item) => {
          const active = isNavActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={navItemClass(active, true)}
              aria-label={item.label}
            >
              <item.icon
                className={cn("h-5 w-5 shrink-0", active ? "text-brand" : "text-text-3")}
                strokeWidth={1.8}
              />
              <span className="flex-1 truncate lg:hidden">{item.label}</span>
              {item.badge && unread > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-brand-fg lg:right-1 lg:top-1">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
              {/* Tooltip solo en escritorio (drawer ya muestra el label). */}
              <span className="hidden lg:contents">
                <NavTooltip label={item.label} />
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Usuario: avatar elegible + cuenta; en drawer, nombre completo. */}
      <div className="group relative mt-1 flex items-center gap-2.5 rounded-lg py-2 hover:bg-accent lg:justify-center lg:px-0">
        <button
          type="button"
          aria-label={`Cuenta y avatar de ${userName}`}
          aria-haspopup="menu"
          aria-expanded={pickerOpen}
          title={`${userName} · cuenta y avatar`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-lg font-bold text-brand-text"
          onClick={() => setPickerOpen((v) => !v)}
        >
          {selectedAvatar ? (
            <span className="leading-none" aria-hidden>{selectedAvatar.emoji}</span>
          ) : (
            <span className="text-xs">{initials(userName)}</span>
          )}
        </button>
        <span className="min-w-0 flex-1 lg:hidden">
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

        {/* Tooltip del usuario en escritorio. */}
        <span className="hidden lg:contents">
          <NavTooltip label={`${userName} · cuenta y avatar`} />
        </span>
      </div>

      {/* Versión del build: discreta, clic para ver el commit. */}
      <button
        className="mt-2 hidden text-center font-mono text-[10px] tracking-[0.06em] text-text-2 lg:block"
        title={
          sha
            ? `${branding.name} ${APP_VERSION}, construido del commit ${sha}`
            : `${branding.name} ${APP_VERSION}`
        }
        onClick={() => setShowVersion((v) => !v)}
      >
        {showVersion && sha ? versionLabel(sha) : APP_VERSION}
      </button>
    </aside>
  );
}
