"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadError } from "@/components/load-error";
import {
  WEBCHAT_ORIGINS_MAX,
  WEBCHAT_TITLE_MAX,
  WEBCHAT_WELCOME_MAX,
  type WebchatSettings,
} from "@/lib/webchat";

type Payload = { settings: WebchatSettings; snippet: string };

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pantalla del chat del sitio. La llave pública y el snippet los calcula el
 * servidor: aquí solo se muestran y se copian, para que el dueño no pueda
 * pegar en su web una llave inventada.
 */
export function WebchatClient() {
  const [settings, setSettings] = useState<WebchatSettings | null>(null);
  const [snippet, setSnippet] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<"key" | "snippet" | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [title, setTitle] = useState("");
  const [welcome, setWelcome] = useState("");
  const [origins, setOrigins] = useState("");

  const apply = useCallback((data: Payload) => {
    setSettings(data.settings);
    setSnippet(data.snippet);
    setEnabled(data.settings.enabled);
    setTitle(data.settings.title);
    setWelcome(data.settings.welcome);
    setOrigins(data.settings.allowedOrigins.join("\n"));
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/settings/webchat", { cache: "no-store" }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as Payload | null) : null;
    if (data) {
      apply(data);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
    setLoading(false);
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function put(body: Record<string, unknown>): Promise<Payload | null> {
    const res = await fetch("/api/settings/webchat", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setMessage({ ok: false, text: data?.error?.message ?? "No se pudo guardar la configuración" });
      return null;
    }
    const data = (await res.json().catch(() => null)) as Payload | null;
    if (data) apply(data);
    return data;
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const data = await put({
      enabled,
      title: title.trim(),
      welcome: welcome.trim(),
      allowedOrigins: origins
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    });
    setSaving(false);
    if (data) setMessage({ ok: true, text: "Configuración guardada" });
  }

  async function rotate() {
    if (
      !window.confirm(
        "¿Generar una llave nueva? El snippet anterior dejará de funcionar y la burbuja desaparecerá de tu web hasta que pegues el nuevo."
      )
    ) {
      return;
    }
    setRotating(true);
    setMessage(null);
    const data = await put({
      enabled,
      title: title.trim(),
      welcome: welcome.trim(),
      allowedOrigins: origins
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      rotateKey: true,
    });
    setRotating(false);
    if (data) setMessage({ ok: true, text: "Llave rotada: pega el snippet nuevo en tu web" });
  }

  async function copyValue(which: "key" | "snippet", value: string) {
    if (await copy(value)) {
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1600);
    }
  }

  if (loading) {
    return <p className="text-sm text-text-3">Cargando…</p>;
  }
  if (loadFailed || !settings) {
    return <LoadError message="No se pudo leer la configuración del chat del sitio." onRetry={() => void refresh()} />;
  }

  const previewHref = settings.publicKey ? `/embed/webchat?key=${settings.publicKey}` : null;

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-lg border bg-background p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[15px] font-bold">Chat del sitio</h3>
            <p className="mt-1 text-sm text-text-2">
              Una burbuja de chat para tu web. Los mensajes entran a la Bandeja
              como un canal más y el agente puede contestarlos.
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            Activo
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="webchat-title">Título de la ventana</Label>
            <Input
              id="webchat-title"
              value={title}
              maxLength={WEBCHAT_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Escríbenos"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="webchat-welcome">Mensaje de bienvenida</Label>
            <Input
              id="webchat-welcome"
              value={welcome}
              maxLength={WEBCHAT_WELCOME_MAX}
              onChange={(e) => setWelcome(e.target.value)}
              placeholder="¡Hola! Déjanos tu mensaje y te contestamos por aquí."
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="webchat-origins">Dominios autorizados (opcional)</Label>
          <Textarea
            id="webchat-origins"
            value={origins}
            rows={3}
            onChange={(e) => setOrigins(e.target.value)}
            placeholder={"https://tunegocio.com\nhttps://www.tunegocio.com"}
          />
          <p className="text-xs text-text-3">
            Uno por línea, máximo {WEBCHAT_ORIGINS_MAX}. Si lo dejas vacío el
            chat acepta mensajes desde cualquier sitio que tenga tu llave; con
            dominios, solo desde esos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void save()} disabled={saving}>
            <Save className="h-4 w-4" strokeWidth={1.8} />
            {saving ? "Guardando…" : "Guardar"}
          </Button>
          {message && (
            <p className={message.ok ? "text-sm text-text-2" : "text-sm text-destructive"}>
              {message.text}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border bg-background p-4">
        <div>
          <h3 className="text-[15px] font-bold">Instálalo en tu web</h3>
          <p className="mt-1 text-sm text-text-2">
            Pega este código antes de <code className="font-mono text-xs">&lt;/body&gt;</code>.
            Aparecerá una burbuja en la esquina inferior derecha.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="webchat-snippet">Snippet</Label>
          <Textarea
            id="webchat-snippet"
            value={snippet}
            readOnly
            rows={3}
            spellCheck={false}
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="webchat-key">Llave pública</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="webchat-key"
              value={settings.publicKey}
              readOnly
              spellCheck={false}
              className="min-w-[16rem] flex-1 font-mono text-xs"
            />
            <Button variant="outline" onClick={() => void copyValue("key", settings.publicKey)}>
              {copied === "key" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              Copiar
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void copyValue("snippet", snippet)}>
            {copied === "snippet" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copiar snippet
          </Button>
          {previewHref && (
            <Button variant="outline" onClick={() => window.open(previewHref, "_blank", "noopener")}>
              <ExternalLink className="h-4 w-4" strokeWidth={1.8} />
              Vista previa
            </Button>
          )}
          <Button variant="ghost" onClick={() => void rotate()} disabled={rotating}>
            <RotateCcw className="h-4 w-4" strokeWidth={1.8} />
            {rotating ? "Rotando…" : "Rotar llave"}
          </Button>
        </div>

        {!enabled && (
          <p className="rounded-md border border-dashed p-2.5 text-xs text-text-3">
            El chat está apagado: el snippet no muestra la burbuja hasta que lo
            actives y guardes.
          </p>
        )}
      </section>
    </div>
  );
}
