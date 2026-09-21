"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { TemplateDto } from "@/lib/types";
import { countVariables, validateBodyVariables } from "@/lib/templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const STATUS_BADGE: Record<
  TemplateDto["status"],
  { label: string; variant: "secondary" | "warning" | "success" | "destructive" }
> = {
  draft: { label: "Borrador", variant: "secondary" },
  pending: { label: "Pendiente de Meta", variant: "warning" },
  approved: { label: "Aprobada", variant: "success" },
  rejected: { label: "Rechazada", variant: "destructive" },
};

export function TemplatesClient() {
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/templates").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { templates: TemplateDto[] };
    setTemplates(data.templates);
  }, []);

  /**
   * `silent`: sincronización automática al abrir la pantalla. Meta entrega
   * `message_template_status_update` al callback A NIVEL APP, que en modo
   * agencia no es el de esta instancia — sin este pull la plantilla se queda
   * "Pendiente de Meta" para siempre aunque ya esté aprobada.
   */
  const sync = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setSyncing(true);
        setSyncMsg(null);
      }
      const res = await fetch("/api/templates/sync", { method: "POST" }).catch(
        () => null
      );
      if (!silent) setSyncing(false);
      if (res?.ok) {
        const data = (await res.json()) as { updated: number };
        if (!silent) {
          setSyncMsg(
            data.updated > 0
              ? `${data.updated} plantilla(s) actualizada(s)`
              : "Todo al día"
          );
        }
        if (!silent || data.updated > 0) void refetch();
      } else if (!silent) {
        // El auto-sync falla en silencio: la lista local ya se pintó.
        const data = (await res?.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setSyncMsg(data?.error?.message ?? "No se pudo sincronizar");
      }
    },
    [refetch]
  );

  useEffect(() => {
    void refetch().then(() => sync({ silent: true }));
  }, [refetch, sync]);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Las plantillas permiten reabrir conversaciones con la ventana de 24 h
            cerrada. Meta las aprueba en horas o días y puede reclasificar la
            categoría (lo que cambia el costo por conversación). Esta pantalla
            consulta el estado a Meta cada vez que la abres; Sincronizar fuerza
            la consulta sin recargar.
          </p>
          <div className="mt-3 rounded-lg border border-brand-soft bg-brand-tint p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">¿Cuándo usar una plantilla?</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>Cuando un cliente no te escribe en 24 h y quieres darle seguimiento</li>
              <li>Para enviar recordatorios de citas o cotizaciones</li>
              <li>Para promociones o campañas de marketing</li>
              <li>Para confirmaciones de pedido o envío</li>
            </ul>
          </div>
        </div>
        <Button variant="outline" size="sm" disabled={syncing} onClick={() => void sync()}>
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          Sincronizar
        </Button>
      </div>
      {syncMsg && <p className="text-xs text-muted-foreground">{syncMsg}</p>}

      <CreateForm onCreated={() => void refetch()} />

      {/* Quick examples */}
      <ExamplesSection />

      <div className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-sm font-medium">
                {t.name}{" "}
                <span className="text-muted-foreground">
                  ({t.language} · {t.category})
                </span>
              </p>
              <Badge variant={STATUS_BADGE[t.status].variant}>
                {STATUS_BADGE[t.status].label}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t.body}</p>
            {t.status === "rejected" && t.rejectionReason && (
              <p className="mt-2 text-xs text-destructive">
                Razón del rechazo: {t.rejectionReason}
              </p>
            )}
          </div>
        ))}
        {templates.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Sin plantillas todavía. Crea la primera arriba — por ejemplo un
            «seguimos disponibles, ¿retomamos tu cotización?» para
            conversaciones frías.
          </p>
        )}
      </div>
    </div>
  );
}

const EXAMPLES = [
  { name: "Seguimiento de cotización", body: "Hola {{1}}, ¿ya revisaste la cotización que te envié? ¿Tienes alguna duda? Estoy disponible para ayudarte." },
  { name: "Recordatorio de cita", body: "Hola {{1}}, te recuerdo que tienes una cita programada para el {{2}} a las {{3}}. ¿Confirmas asistencia?" },
  { name: "Agradecimiento", body: "¡Gracias {{1}} por tu compra! Tu pedido #{{2}} está siendo procesado. Te avisaremos cuando esté listo para entrega." },
  { name: "Promoción", body: "¡Hola {{1}}! Tenemos una oferta especial para ti: {{2}} con {{3}}% de descuento hasta el {{4}}. ¿Te interesa?" },
];

function ExamplesSection() {
  // This is purely informational - clicking copies the example to clipboard
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Ejemplos de plantillas comunes (haz clic para copiar):</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.name}
            onClick={() => {
              navigator.clipboard.writeText(ex.body).catch(() => {});
            }}
            className="rounded-lg border border-dashed p-3 text-left text-xs transition-colors hover:bg-accent"
          >
            <p className="font-medium text-foreground">{ex.name}</p>
            <p className="mt-1 text-muted-foreground line-clamp-2">{ex.body}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("es_MX");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Misma validación que el servidor: avisa antes de gastar una llamada a Meta.
  const bodyError = body.trim() ? validateBodyVariables(body) : null;
  const variableCount = countVariables(body);

  async function create() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, language, category, body }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo crear la plantilla");
      return;
    }
    setName("");
    setBody("");
    onCreated();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva plantilla</CardTitle>
        <CardDescription>
          Cuerpo con las variables que necesites: numéralas{" "}
          <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>, <code>{"{{3}}"}</code>
          … en orden y sin saltos. Se envía a aprobación de Meta al crearla.
        </CardDescription>
        <div className="mt-2 rounded-md bg-secondary p-2 text-xs text-muted-foreground">
          <p><strong>Nombre:</strong> sin espacios ni caracteres especiales (usa guiones bajos). Ej: <code>seguimiento_cotizacion</code></p>
          <p><strong>Idioma:</strong> <code>es_MX</code> para español de México.</p>
          <p><strong>Categoría:</strong> UTILITY = seguimiento/transacciones (más barato). MARKETING = promociones.</p>
          <p><strong>Variables:</strong> usa <code>{"{{1}}"}</code> para el primer dato dinámico, <code>{"{{2}}"}</code> para el segundo, etc. Ej: &ldquo;Hola {"{{1}}"}, tu cita es el {"{{2}}"}.&rdquo;          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Nombre</Label>
            <Input
              id="tpl-name"
              placeholder="seguimiento_cotizacion"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-lang">Idioma</Label>
            <select
              id="tpl-lang"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="es_MX">es_MX</option>
              <option value="es">es</option>
              <option value="es_AR">es_AR</option>
              <option value="en_US">en_US</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-cat">Categoría</Label>
            <select
              id="tpl-cat"
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as "UTILITY" | "MARKETING")
              }
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="UTILITY">UTILITY (seguimiento)</option>
              <option value="MARKETING">MARKETING</option>
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tpl-body">Cuerpo</Label>
          <Textarea
            id="tpl-body"
            rows={3}
            placeholder="Hola {{1}}, te confirmo tu sesión el {{2}} a las {{3}}."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {bodyError ? (
            <p className="text-xs text-destructive">{bodyError}</p>
          ) : (
            variableCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {variableCount === 1
                  ? "1 variable: al enviar pedirá su valor."
                  : `${variableCount} variables: al enviar pedirá los ${variableCount} valores.`}
              </p>
            )
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Preview */}
        {body.trim() && !bodyError && (
          <div className="rounded-lg border bg-secondary p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Vista previa:</p>
            <p className="whitespace-pre-wrap text-sm">{body}</p>
          </div>
        )}

        <Button
          disabled={saving || !name.trim() || !body.trim() || bodyError !== null}
          onClick={() => void create()}
        >
          {saving ? "Enviando a Meta…" : "Crear y enviar a aprobación"}
        </Button>
      </CardContent>
    </Card>
  );
}
