"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { WEBCHAT_TEXT_MAX, WEBCHAT_VISITOR_PATTERN } from "@/lib/webchat";

/**
 * Panel del chat del sitio: es lo que se ve DENTRO del iframe que inyecta
 * `public/widget/webchat.js`.
 *
 * El visitante no tiene cuenta: su navegador genera un identificador aleatorio
 * la primera vez y lo guarda en `localStorage`. Ese valor viaja con cada
 * mensaje y con cada consulta del hilo; sin él no se puede leer ni escribir
 * nada, y por eso el panel no pide sesión.
 */

type WireMessage = {
  id: string;
  direction: string;
  text: string | null;
  createdAt: string;
};

type Bubble = {
  id: string;
  mine: boolean;
  text: string;
  createdAt: number;
  pending?: boolean;
  failed?: boolean;
};

const POLL_MS = 4000;

function randomId(bytes = 12): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readVisitor(storageKey: string): string {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored && WEBCHAT_VISITOR_PATTERN.test(stored)) return stored;
  } catch {
    // Navegación privada con almacenamiento bloqueado: el hilo durará esta visita.
  }
  const id = randomId(16);
  try {
    window.localStorage.setItem(storageKey, id);
  } catch {
    // Sin almacenamiento se sigue con un id efímero.
  }
  return id;
}

/**
 * Fusiona el hilo del servidor con las burbujas optimistas. El servidor es la
 * verdad: una burbuja «enviando» desaparece en cuanto su texto aparece
 * confirmado, y si el envío falló se queda marcada para que nada se pierda en
 * silencio.
 */
function merge(server: WireMessage[], current: Bubble[]): Bubble[] {
  const confirmed: Bubble[] = server.map((m) => ({
    id: m.id,
    mine: m.direction === "out",
    text: m.text ?? "",
    createdAt: Date.parse(m.createdAt) || Date.now(),
  }));
  const unreconciled = current.filter((b) => {
    if (!b.pending && !b.failed) return false;
    return !(
      b.pending &&
      confirmed.some((c) => c.mine && c.text === b.text)
    );
  });
  return [...confirmed, ...unreconciled].sort((a, b) => a.createdAt - b.createdAt);
}

export function WebchatPanel({ publicKey }: { publicKey: string }) {
  const storageKey = `lumark:webchat:visitor:${publicKey}`;
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [title, setTitle] = useState("Escríbenos");
  const [welcome, setWelcome] = useState("");
  const [visitor, setVisitor] = useState("");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [embedded, setEmbedded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEmbedded(window.self !== window.top);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setVisitor(readVisitor(storageKey));
    fetch(`/api/webchat/${publicKey}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setStatus("unavailable");
          return;
        }
        const data = (await res.json()) as { title?: string; welcome?: string };
        setTitle(data.title || "Escríbenos");
        setWelcome(data.welcome ?? "");
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey, storageKey]);

  const load = useCallback(async () => {
    if (!visitor) return;
    try {
      const res = await fetch(
        `/api/webchat/${publicKey}/messages?visitor=${encodeURIComponent(visitor)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: WireMessage[] };
      setBubbles((current) => merge(data.messages ?? [], current));
    } catch {
      // Red inestable: la siguiente vuelta del sondeo recupera la última página.
    }
  }, [publicKey, visitor]);

  useEffect(() => {
    if (status !== "ready" || !visitor) return;
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [status, visitor, load]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [bubbles.length]);

  // Al abrir, el foco pasa a este documento: el Escape del lanzador (que vive en
  // la web del cliente) ya no recibe la tecla. Sin esto, Escape no cerraba nada.
  useEffect(() => {
    if (!embedded) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        window.parent.postMessage({ type: "lumark-webchat-close" }, "*");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [embedded]);

  const bytes = new TextEncoder().encode(text).byteLength;
  const tooLong = bytes > WEBCHAT_TEXT_MAX;
  const canSend = text.trim().length > 0 && !tooLong && !sending && status === "ready";

  async function submit() {
    const value = text.trim();
    if (!value || !visitor || sending) return;
    if (new TextEncoder().encode(value).byteLength > WEBCHAT_TEXT_MAX) {
      setError("El mensaje es demasiado largo");
      return;
    }
    const clientMessageId = randomId();
    const localId = `local-${clientMessageId}`;
    setError(null);
    setBubbles((current) => [
      ...current,
      { id: localId, mine: true, text: value, createdAt: Date.now(), pending: true },
    ]);
    setText("");
    setSending(true);
    try {
      const res = await fetch(`/api/webchat/${publicKey}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visitorId: visitor, text: value, clientMessageId }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setBubbles((current) =>
        current.map((b) =>
          b.id === localId ? { ...b, pending: false, failed: true } : b
        )
      );
      // Lo que no salió vuelve al campo: se puede reintentar tal cual.
      setText(value);
      setError("No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSending(false);
      void load();
    }
  }

  function close() {
    window.parent.postMessage({ type: "lumark-webchat-close" }, "*");
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b bg-subtle px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="text-[11.5px] text-text-3">Chat del sitio</p>
        </div>
        {embedded && (
          <button
            onClick={close}
            aria-label="Cerrar chat"
            className="flex min-h-11 min-w-11 items-center justify-center rounded text-text-3 hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        )}
      </header>

      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {status === "unavailable" && (
          <p className="mt-8 text-center text-sm text-text-2">
            Este chat no está disponible en este momento.
          </p>
        )}
        {status === "loading" && (
          <p className="mt-8 text-center text-sm text-text-3">Cargando…</p>
        )}
        {status === "ready" && welcome && (
          <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-subtle px-3 py-2 text-sm">
            {welcome}
          </div>
        )}
        {bubbles.map((b) => (
          <div key={b.id} className={cn("flex", b.mine ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                b.mine
                  ? "rounded-br-md bg-brand text-brand-fg"
                  : "rounded-bl-md border bg-background",
                b.failed && "border-destructive/50 bg-destructive/10 text-destructive"
              )}
            >
              {b.text}
              {b.pending && <span className="ml-2 text-[10px] opacity-70">enviando…</span>}
              {b.failed && <span className="ml-2 text-[10px]">no enviado</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t p-2.5">
        {error && <p className="mb-1.5 px-1 text-xs text-destructive">{error}</p>}
        <div className="flex items-end gap-1.5 rounded-[21px] border border-border-strong bg-background py-1 pl-3 pr-1 focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft">
          <textarea
            value={text}
            rows={1}
            placeholder="Escribe tu mensaje…"
            enterKeyHint="send"
            autoCorrect="on"
            spellCheck
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            className="max-h-24 min-w-0 flex-1 resize-none self-center bg-transparent py-1.5 text-sm leading-relaxed outline-none placeholder:text-text-3"
          />
          <button
            onClick={() => void submit()}
            disabled={!canSend}
            aria-label="Enviar"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg transition-opacity hover:bg-brand-hover",
              !canSend && "opacity-40"
            )}
          >
            <Send className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
        <p className="mt-1 px-1 text-right font-mono text-[10px] text-text-3">
          {tooLong ? "Mensaje demasiado largo" : `${bytes}/${WEBCHAT_TEXT_MAX}`}
        </p>
      </div>
    </div>
  );
}
