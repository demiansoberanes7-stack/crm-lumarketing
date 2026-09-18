"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Connection = {
  tiktokUserId: string | null;
  username: string | null;
  accountRef: string | null;
  status: "connected" | "reconnect_required";
  tokenLast4: string;
};

type WebhookInfo = {
  tiktokUrl: string | null;
  verifyToken: string;
  isHttps: boolean;
  signatureLayer: boolean;
};

const HELP = {
  title: "Conecta la cuenta de TikTok en Zernio y pega aquí su accountId y tu API key",
  items: [
    "La cuenta de TikTok se vincula en el panel de Zernio, no desde LUMARK. Copia de ahí el accountId de la cuenta conectada.",
    "La API key se crea en Zernio → Settings → API Keys y se muestra una sola vez (empieza con sk_).",
    "El mismo webhook de Zernio entrega Instagram, Messenger y TikTok si esas cuentas están conectadas; LUMARK filtra por plataforma.",
    "El secreto del webhook es opcional pero recomendado: con él se verifica la firma de cada entrega.",
    "TikTok DMs solo permiten responder a mensajes recibidos (no cold outreach). Soporta texto e imágenes (máx 3 MB).",
  ],
};

export function TikTokClient() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [accountRef, setAccountRef] = useState("");
  const [token, setToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState<"url" | "token" | null>(null);

  const refetch = useCallback(async () => {
    const [c, w] = await Promise.all([
      fetch("/api/settings/tiktok").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/settings/webhook").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    if (c) {
      setConnection(c.connection);
      if (c.connection) {
        if (c.connection.accountRef) setAccountRef(c.connection.accountRef);
      }
    }
    if (w) setWebhook(w);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(null);
    const res = await fetch("/api/settings/tiktok", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountRef: accountRef.trim(),
        token: token.trim(),
        webhookSecret: webhookSecret.trim() || null,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo conectar TikTok");
      return;
    }
    const data = (await res.json()) as { username?: string | null };
    setToken("");
    setWebhookSecret("");
    setSaved(data.username ? `TikTok conectado: @${data.username}` : "Conexión guardada");
    void refetch();
  }

  async function copy(text: string, what: "url" | "token") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // sin portapapeles
    }
  }

  if (!loaded) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  const canSave =
    token.trim().length > 0 && accountRef.trim().length > 0;

  return (
    <div className="max-w-3xl space-y-6">
      {connection?.status === "reconnect_required" && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-danger-text">
              El token expiró o fue revocado.
            </p>
            <p className="text-danger-text opacity-80">
              Los envíos por TikTok están pausados. Pega uno nuevo abajo para
              reconectar.
            </p>
          </div>
        </div>
      )}

      {connection?.status === "connected" && (
        <div className="flex items-center gap-3 rounded-lg border border-success-soft bg-success-tint p-4">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-success-text">
              Conectado por Zernio
              {connection.username ? `: @${connection.username}` : ""}
            </p>
            <p className="text-success-text opacity-80">
              Cuenta {connection.accountRef} · token que termina en ····{connection.tokenLast4}
            </p>
          </div>
          <Badge variant="success">TikTok activo</Badge>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {connection ? "Reconectar TikTok" : "Conectar TikTok"}
          </CardTitle>
          <CardDescription>
            Los mensajes de TikTok entran a la misma bandeja que WhatsApp,
            Instagram y Messenger, con su distintivo de canal. {HELP.title}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-xs text-text-2">
            {HELP.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tt-account">accountId de Zernio</Label>
              <Input
                id="tt-account"
                value={accountRef}
                onChange={(e) => setAccountRef(e.target.value)}
                placeholder="665f1c2e8b3a4d0012345678"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tt-token">API key de Zernio</Label>
              <Input
                id="tt-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="sk_…"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tt-secret">Secreto del webhook (opcional)</Label>
              <Input
                id="tt-secret"
                type="password"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder="el mismo que pusiste en Zernio"
                autoComplete="off"
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm text-success-text">{saved} ✓</p>}

          <Button disabled={saving || !canSave} onClick={() => void save()}>
            {saving ? "Probando…" : "Probar y guardar"}
          </Button>
        </CardContent>
      </Card>

      {webhook?.tiktokUrl && (
        <Card>
          <CardHeader>
            <CardTitle>Webhook de TikTok</CardTitle>
            <CardDescription>
              En Zernio, da de alta este endpoint con el evento{" "}
              <code>message.received</code> y, si usas secreto, el mismo que
              pegaste arriba.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>URL de callback</Label>
              <div className="flex gap-2">
                <Input readOnly value={webhook.tiktokUrl} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copiar la URL"
                  onClick={() => void copy(webhook.tiktokUrl!, "url")}
                >
                  {copied === "url" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <p className="flex items-start gap-2 text-xs text-text-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Con secreto configurado, cada entrega se verifica con su firma HMAC; sin él, la protección es el segmento secreto de la URL.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
