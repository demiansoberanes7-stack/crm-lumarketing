"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, RefreshCw, Trash2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AiSummary = {
  configured: boolean;
  source: "db" | "env" | "none";
  last4: string | null;
};

type Message = { ok: boolean; text: string } | null;

/**
 * Tarjeta "Clave de IA": una sola clave OpenRouter-compatible alimenta al
 * agente de la bandeja y al copiloto. Se guarda cifrada en el servidor (BD)
 * y solo se expone su último fragmento; probar la conexión es opcional.
 */
export function AiProviderCard() {
  const [summary, setSummary] = useState<AiSummary | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    setDenied(false);
    const response = await fetch("/api/settings/ai", { cache: "no-store" }).catch(() => null);
    if (!response) {
      setLoadFailed(true);
      return;
    }
    if (response.status === 403) {
      setDenied(true);
      return;
    }
    const data = await response.json().catch(() => null) as { ai?: AiSummary } | null;
    if (response.ok && data?.ai) setSummary(data.ai);
    else setLoadFailed(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => null) as { ai?: AiSummary; error?: { message?: string } } | null;
      if (!response.ok || !data?.ai) throw new Error(data?.error?.message ?? "No se pudo guardar la clave de IA.");
      setSummary(data.ai);
      setToken("");
      setMessage({ ok: true, text: "Clave guardada. El agente y el copiloto la usarán en el siguiente turno." });
    } catch (cause) {
      setMessage({ ok: false, text: cause instanceof Error ? cause.message : "No se pudo guardar la clave de IA." });
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/ai/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token || `····${summary?.last4 ?? ""}` }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: { message?: string } } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? "El proveedor rechazó la clave.");
      setMessage({ ok: true, text: "Conexión verificada con el proveedor de IA." });
    } catch (cause) {
      setMessage({ ok: false, text: cause instanceof Error ? cause.message : "No se pudo probar la clave." });
    } finally {
      setTesting(false);
    }
  }

  async function handleRemove() {
    if (!window.confirm("¿Quitar la clave guardada? El agente volverá a la variable de entorno si existe.")) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/ai", { method: "DELETE" });
      const data = await response.json().catch(() => null) as { ai?: AiSummary; error?: { message?: string } } | null;
      if (!response.ok || !data?.ai) throw new Error(data?.error?.message ?? "No se pudo quitar la clave.");
      setSummary(data.ai);
      setToken("");
      setMessage({ ok: true, text: "Clave guardada eliminada." });
    } catch (cause) {
      setMessage({ ok: false, text: cause instanceof Error ? cause.message : "No se pudo quitar la clave." });
    } finally {
      setBusy(false);
    }
  }

  if (denied) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Clave de IA</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Solo el propietario puede administrar la clave de IA de la instancia.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card aria-label="Clave de IA del agente y copiloto">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Clave de IA · agente y copiloto</CardTitle>
          {summary?.source === "db" && (
            <Badge variant="outline" className="border-success-soft bg-success-tint text-success-text">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Guardada en el servidor{summary.last4 ? ` ····${summary.last4}` : ""}
            </Badge>
          )}
          {summary?.source === "env" && (
            <Badge variant="outline" className="border-warning-soft bg-warning-tint text-warning-text">
              Variable de entorno{summary.last4 ? ` ····${summary.last4}` : ""}
            </Badge>
          )}
          {summary?.source === "none" && (
            <Badge variant="outline" className="border-danger-soft bg-danger-tint text-danger-text">
              <XCircle className="mr-1 h-3 w-3" /> Sin clave
            </Badge>
          )}
        </div>
        <CardDescription>
          Una sola clave OpenRouter-compatible alimenta al Agente (bandeja) y al Copiloto.
          Se guarda cifrada en el servidor; solo se muestra su último fragmento.
          {summary?.source === "env" && " Guardar una clave aquí tiene prioridad sobre OPENROUTER_API_TOKEN."}
          {" "}El modelo (OPENROUTER_MODEL) sigue definiéndose en el entorno.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {message && (
          <p
            role={message.ok ? "status" : "alert"}
            className={`flex items-start gap-2 rounded-md border p-3 text-sm ${message.ok ? "border-success-soft bg-success-tint text-success-text" : "border-danger-soft bg-danger-tint text-danger-text"}`}
          >
            {message.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            {message.text}
          </p>
        )}

        {loadFailed && (
          <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">
            No se pudo cargar el estado de la clave.{" "}
            <button type="button" className="font-medium underline" onClick={() => void load()}>Reintentar</button>
          </p>
        )}

        {summary && (
          <form onSubmit={(e) => void handleSave(e)} className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Label htmlFor="ai-token">API key {summary.configured ? "(dejar en blanco para mantener)" : ""}</Label>
              <Input
                id="ai-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required={!summary.configured}
                placeholder="sk-… / gsk_…"
                autoComplete="off"
              />
            </div>
            <Button type="submit" disabled={busy || (!token && summary.source === "none")}>
              {busy ? <RefreshCw className="mr-1 h-4 w-4 animate-spin" /> : null}
              {busy ? "Guardando…" : "Guardar"}
            </Button>
            <Button type="button" variant="outline" onClick={() => void handleTest()} disabled={testing || (!token && !summary.configured)}>
              <CheckCircle2 className={`mr-1 h-4 w-4 ${testing ? "animate-pulse" : ""}`} />
              {testing ? "Probando…" : "Probar conexión"}
            </Button>
            {summary.source === "db" && (
              <Button type="button" variant="outline" onClick={() => void handleRemove()} disabled={busy || testing}>
                <Trash2 className="mr-1 h-4 w-4" /> Quitar clave
              </Button>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
