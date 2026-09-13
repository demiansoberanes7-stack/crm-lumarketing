"use client";

import { useCallback, useEffect, useState } from "react";
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

type Session = {
  id: string;
  status: string;
  me?: { id?: string; pushName?: string };
};

type WahaState = {
  configured: boolean;
  status: string;
  sessions: Session[];
};

export function WahaClient() {
  const [waha, setWaha] = useState<WahaState | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/whatsapp/waha").catch(() => null);
    if (!res?.ok) return setWaha({ configured: false, status: "unknown", sessions: [] });
    const data = (await res.json()) as WahaState;
    setWaha(data);
    setBaseUrl(data.configured ? baseUrl : baseUrl);
  }, [baseUrl]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/settings/whatsapp/waha").catch(() => null);
      if (!res?.ok) return setWaha({ configured: false, status: "unknown", sessions: [] });
      const data = (await res.json()) as WahaState;
      setWaha(data);
    })();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/settings/whatsapp/waha", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(body?.error?.message ?? "No se pudo guardar");
      return;
    }
    setApiKey("");
    setSaved(true);
    await load();
  }

  async function sendAction(action: "start" | "stop" | "qr", sessionId?: string) {
    setActionLoading(action);
    setError(null);
    const res = await fetch("/api/settings/whatsapp/waha", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, sessionId }),
    }).catch(() => null);
    setActionLoading(null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(body?.error?.message ?? "Acción fallida");
      return;
    }
    await load();
  }

  const statusConnected = waha?.status === "connected" || waha?.sessions?.some((s) => s.status === "open");

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp (WAHA)</CardTitle>
          <CardDescription>
            Conecta tu instancia de WAHA para enviar y recibir mensajes de
            WhatsApp a través de este CRM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="waha-url">URL del servidor WAHA</Label>
            <Input
              id="waha-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:3000"
              className="max-w-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="waha-key">API Key</Label>
            <Input
              id="waha-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Dejar vacío si no usa autenticación"
              autoComplete="off"
              className="max-w-xs"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm text-success-text">Configuración guardada.</p>}

          <div className="flex gap-2">
            <Button disabled={saving || !baseUrl.trim()} onClick={() => void save()}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sesiones</CardTitle>
          <CardDescription>
            Estado de las sesiones de WhatsApp conectadas a WAHA.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Estado:</span>
            {waha === null ? (
              <span className="text-sm text-muted-foreground">Cargando…</span>
            ) : statusConnected ? (
              <Badge variant="success">Conectado</Badge>
            ) : (
              <Badge variant="secondary">Desconectado</Badge>
            )}
          </div>

          {waha?.sessions && waha.sessions.length > 0 && (
            <div className="space-y-2">
              {waha.sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between rounded-md border border-border-strong px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">{session.id}</span>
                    <Badge variant={session.status === "open" ? "success" : "secondary"}>
                      {session.status}
                    </Badge>
                    {session.me?.pushName && (
                      <span className="text-xs text-muted-foreground">
                        {session.me.pushName}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!actionLoading}
                    onClick={() => void sendAction("qr", session.id)}
                  >
                    {actionLoading === "qr" ? "…" : "Ver QR"}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {waha && waha.sessions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay sesiones activas. Inicia una sesión para conectarte.
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!waha?.configured || !!actionLoading}
              onClick={() => void sendAction("start")}
            >
              {actionLoading === "start" ? "Iniciando…" : "Iniciar Sesión"}
            </Button>
            <Button
              variant="outline"
              disabled={!waha?.configured || !!actionLoading}
              onClick={() => void sendAction("stop")}
            >
              {actionLoading === "stop" ? "Deteniendo…" : "Detener Sesión"}
            </Button>
            <Button
              variant="outline"
              disabled={!waha?.configured || !!actionLoading}
              onClick={() => void sendAction("qr")}
            >
              {actionLoading === "qr" ? "Cargando…" : "Ver QR"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
