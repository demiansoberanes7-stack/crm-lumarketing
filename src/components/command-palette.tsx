"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { NAV_FOOTER, navItemsFor } from "@/config/nav";
import { cn } from "@/lib/utils";

/**
 * Paleta de comandos ⌘K / Ctrl+K, sin dependencias: filtra las rutas del nav
 * y navega con Enter o clic. `onOpenChange` deja que la cabecera pinte el
 * botón que la invoca.
 */
export function CommandPalette({ open, agenda, onOpenChange }: { open: boolean; agenda: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => [...navItemsFor({ agenda }), ...NAV_FOOTER], [agenda]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) || item.href.toLowerCase().includes(q)
    );
  }, [items, query]);

  const close = useCallback(() => {
    onOpenChange(false);
    setQuery("");
    setIndex(0);
  }, [onOpenChange]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router]
  );

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  // Auto-scroll del item activo dentro de la lista.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [index, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-overlay pt-[18vh]"
      onClick={close}
      role="presentation"
    >
      <div
        className="w-[min(92vw,32rem)] overflow-hidden rounded-xl border border-border bg-card shadow-pop"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.8} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, filtered.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter" && filtered[index]) go(filtered[index]!.href);
            }}
            placeholder="Ir a una sección…"
            className="h-11 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-text-3"
            aria-label="Buscar sección"
          />
          <kbd className="pointer-events-none hidden shrink-0 rounded border border-border bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-3 sm:block">
            esc
          </kbd>
        </div>
        <div ref={listRef} className="max-h-[240px] overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-text-3">Sin resultados</p>
          )}
          {filtered.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => go(item.href)}
                onMouseEnter={() => setIndex(i)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-text-2 transition-colors",
                  i === index && "bg-accent text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.8} />
                {item.label}
                <span className="ml-auto font-mono text-[10.5px] text-text-3">{item.href}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Atajo global ⌘K / Ctrl+K. Se monta una vez en el shell. */
export function useCommandPaletteShortcut(onOpen: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}
