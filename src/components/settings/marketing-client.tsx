"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3, CheckCircle2, Circle, Info, Plug, RefreshCw, Save, AlertCircle, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/* ─── Types ─── */
interface GoogleAdsCreds {
  customerId: string;
  developerToken: string;
  clientId: string;
  clientSecret: string;
}
interface MetaAdsCreds {
  accessToken: string;
  adAccountId: string;
}
interface Ga4Creds {
  propertyId: string;
  /** Solo llega del servidor como bandera; el JSON nunca cruza al cliente. */
  serviceAccountConfigured?: boolean;
}

/**
 * Estado de la conexión, no "campos llenos".
 *
 * `saved` existe por Google Ads: hay credenciales guardadas que no se pueden
 * verificar de extremo a extremo, y el tilde NO se pone verde por tener datos
 * en los campos.
 */
type Provider = "google_ads" | "meta_ads" | "ga4";
type TestState = "idle" | "testing" | "connected" | "error" | "saved" | "missing";
type TestStatus = { state: TestState; message?: string };

const IDLE: TestStatus = { state: "idle" };

function StatusBadge({ status }: { status: TestStatus }) {
  if (status.state === "testing") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Verificando…
      </span>
    );
  }
  if (status.state === "connected") {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
        <CheckCircle2 className="h-4 w-4" /> Conectado
      </span>
    );
  }
  if (status.state === "error") {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-red-600" title={status.message}>
        <XCircle className="h-4 w-4" /> Sin conectar
      </span>
    );
  }
  if (status.state === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={status.message}>
        <Circle className="h-3.5 w-3.5" /> Guardado · sin verificar
      </span>
    );
  }
  if (status.state === "missing") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={status.message}>
        <Circle className="h-3.5 w-3.5" /> Sin configurar
      </span>
    );
  }
  return null;
}

function TestButton({
  onClick,
  testing,
  disabled,
}: {
  onClick: () => void;
  testing: boolean;
  disabled?: boolean;
}) {
  return (
    <Button variant="outline" onClick={onClick} disabled={testing || disabled}>
      {testing ? (
        <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Probando…</>
      ) : (
        <><Plug className="mr-2 h-4 w-4" /> Probar conexión</>
      )}
    </Button>
  );
}

function TestMessage({ status }: { status: TestStatus }) {
  if (!status.message || status.state === "testing" || status.state === "idle") return null;
  const bad = status.state === "error";
  return (
    <p className={`flex items-center gap-1.5 text-sm ${bad ? "text-red-600" : "text-emerald-600"}`}>
      {bad ? <XCircle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
      <span>{status.message}</span>
    </p>
  );
}


function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-[11px] text-muted-foreground leading-snug flex items-start gap-1">
      <Info className="h-3 w-3 mt-0.5 shrink-0 text-blue-400" />
      {children}
    </p>
  );
}

export function MarketingClient() {
  const router = useRouter();
  const [googleAds, setGoogleAds] = useState<GoogleAdsCreds>({
    customerId: "", developerToken: "", clientId: "", clientSecret: "",
  });
  const [metaAds, setMetaAds] = useState<MetaAdsCreds>({ accessToken: "", adAccountId: "" });
  const [ga4, setGa4] = useState<Ga4Creds>({ propertyId: "" });
  const [serviceAccountJson, setServiceAccountJson] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * Estado de conexión de cada integración.
   *
   * NO es "los campos están llenos": el tilde se enciende solo cuando el
   * proveedor respondió bien (`connected`). Mientras tanto queda gris.
   */
  const [tests, setTests] = useState<Record<Provider, TestStatus>>({
    google_ads: IDLE,
    meta_ads: IDLE,
    ga4: IDLE,
  });
  /** Descarta respuestas viejas: se puede volver a probar mientras vuelve la anterior. */
  const testSeq = useRef<Record<Provider, number>>({ google_ads: 0, meta_ads: 0, ga4: 0 });

  const runTest = useCallback(async (provider: Provider, values?: object) => {
    testSeq.current[provider] += 1;
    const seq = testSeq.current[provider];
    setTests((t) => ({ ...t, [provider]: { state: "testing" } }));

    let next: TestStatus;
    try {
      const res = await fetch(`/api/integrations/${provider}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values ?? {}),
      });
      const data = (await res.json().catch(() => null)) as {
        status?: TestState;
        message?: string;
        error?: { message?: string };
      } | null;
      next = data?.status
        ? { state: data.status, message: data.message }
        : { state: "error", message: data?.error?.message ?? "No se pudo probar la conexión." };
    } catch {
      next = { state: "error", message: "Error de red al probar la conexión." };
    }

    if (testSeq.current[provider] !== seq) return;
    setTests((t) => ({ ...t, [provider]: next }));
  }, []);

  useEffect(() => {
    async function load() {
      const [gAds, mAds, ga] = await Promise.all([
        fetch("/api/integrations/google_ads").then(r => r.json()).catch(() => null),
        fetch("/api/integrations/meta_ads").then(r => r.json()).catch(() => null),
        fetch("/api/integrations/ga4").then(r => r.json()).catch(() => null),
      ]);
      if (gAds?.credentials) setGoogleAds(c => ({ ...c, ...gAds.credentials }));
      if (mAds?.credentials) setMetaAds(c => ({ ...c, ...mAds.credentials }));
      if (ga?.credentials) setGa4(c => ({ ...c, ...ga.credentials }));
      setLoading(false);
    }
    void load();
  }, []);

  // Auto-prueba al abrir, con lo GUARDADO (body vacío): así el tilde refleja
  // la conexión real del primer render y no una que nunca se verificó.
  useEffect(() => {
    if (loading) return;
    void Promise.all([runTest("google_ads"), runTest("meta_ads"), runTest("ga4")]);
  }, [loading, runTest]);

  const googleReady = !!(googleAds.customerId && googleAds.developerToken && googleAds.clientId && googleAds.clientSecret);
  const metaReady = !!(metaAds.accessToken && metaAds.adAccountId);
  const ga4Ready = !!ga4.propertyId && (ga4.serviceAccountConfigured === true || serviceAccountJson.trim().length > 0);

  async function save(provider: string, body: unknown): Promise<boolean> {
    const res = await fetch(`/api/integrations/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const results = await Promise.all([
        save("google_ads", googleAds),
        save("meta_ads", metaAds),
        save("ga4", {
          propertyId: ga4.propertyId,
          ...(serviceAccountJson.trim() ? { serviceAccountJson } : {}),
        }),
      ]);
      if (results.every(Boolean)) {
        setSaved(true);
        if (serviceAccountJson.trim()) setGa4(c => ({ ...c, serviceAccountConfigured: true }));
        setServiceAccountJson("");
        setTimeout(() => setSaved(false), 3000);
        router.refresh();
        // Se vuelve a probar con lo recién guardado: el tilde debe reflejar
        // la conexión real, no la que había antes de guardar.
        void Promise.all([runTest("google_ads"), runTest("meta_ads"), runTest("ga4")]);
      } else {
        setSaveError("No se pudo guardar una de las integraciones. Revisa los campos.");
      }
    } catch {
      setSaveError("Error de red al guardar.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Cargando integraciones…</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Marketing</h1>
          <p className="text-sm text-muted-foreground">
            Conecta tus cuentas de ads y analytics para importar métricas reales.
          </p>
        </div>
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saved ? (
            <><CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" /> Guardado</>
          ) : saving ? (
            <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Guardando…</>
          ) : (
            <><Save className="mr-2 h-4 w-4" /> Guardar Cambios</>
          )}
        </Button>
      </div>

      {saveError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-red-500" />
          <p className="text-sm text-red-700">{saveError}</p>
        </div>
      )}

      {/* ── Google Ads ── */}
      <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold text-blue-600">
            <span className="rounded-md bg-blue-100 p-1">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21.35,11.1H12.18V13.83H18.69C18.36,17.64 15.19,19.27 12.19,19.27C8.36,19.27 5,16.25 5,12C5,7.9 8.2,4.73 12.2,4.73C15.29,4.73 17.1,6.7 17.1,6.7L19,4.72C19,4.72 16.56,2 12.1,2C6.42,2 2.03,6.8 2.03,12C2.03,17.05 6.16,22 12.25,22C17.6,22 21.5,18.33 21.5,12.91C21.5,11.76 21.35,11.1 21.35,11.1Z" />
              </svg>
            </span>
            Google Ads
          </h3>
          <StatusBadge status={tests.google_ads} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Customer ID</Label>
            <Input
              placeholder="123-456-7890"
              value={googleAds.customerId}
              onChange={e => setGoogleAds(c => ({ ...c, customerId: e.target.value }))}
            />
            <FieldHint>
              En Google Ads → icono de llave inglesa (⚙️) → Configuración de la cuenta. Aparece como <strong>“ID de cliente”</strong>.
            </FieldHint>
          </div>
          <div>
            <Label>Developer Token</Label>
            <Input
              type="password"
              placeholder="Token de Google Ads API"
              value={googleAds.developerToken}
              onChange={e => setGoogleAds(c => ({ ...c, developerToken: e.target.value }))}
            />
            <FieldHint>
              En Google Ads API Center (<code>ads.google.com/aw/apicenter</code>). Necesitas cuenta de administrador (MCC).
            </FieldHint>
          </div>
          <div>
            <Label>Client ID (OAuth)</Label>
            <Input
              placeholder="OAuth Client ID"
              value={googleAds.clientId}
              onChange={e => setGoogleAds(c => ({ ...c, clientId: e.target.value }))}
            />
            <FieldHint>
              En Google Cloud Console → APIs & Services → Credentials → <strong>Create OAuth 2.0 Client ID</strong>.
            </FieldHint>
          </div>
          <div>
            <Label>Client Secret (OAuth)</Label>
            <Input
              type="password"
              placeholder="OAuth Client Secret"
              value={googleAds.clientSecret}
              onChange={e => setGoogleAds(c => ({ ...c, clientSecret: e.target.value }))}
            />
            <FieldHint>
              Mismo panel de Google Cloud → se genera junto al Client ID.
            </FieldHint>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <TestButton
            onClick={() => void runTest("google_ads", googleAds)}
            testing={tests.google_ads.state === "testing"}
            disabled={!googleReady}
          />
          <TestMessage status={tests.google_ads} />
        </div>
        <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          Guardado: la lectura de métricas de Google Ads aún no está activa; las credenciales quedan listas para su módulo.
        </p>
      </div>

      {/* ── Meta Ads ── */}
      <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold text-indigo-700">
            <span className="rounded-md bg-indigo-100 p-1">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02Z" />
              </svg>
            </span>
            Meta Ads (Facebook & Instagram)
          </h3>
          <StatusBadge status={tests.meta_ads} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Ad Account ID</Label>
            <Input
              placeholder="act_123456789"
              value={metaAds.adAccountId}
              onChange={e => setMetaAds(c => ({ ...c, adAccountId: e.target.value }))}
            />
            <FieldHint>
              En Meta Business Suite → Configuración del negocio → <strong>Cuentas publicitarias</strong>. El ID empieza con <code>act_</code>.
            </FieldHint>
          </div>
          <div>
            <Label>System User Access Token</Label>
            <Input
              type="password"
              placeholder="EAAB…"
              value={metaAds.accessToken}
              onChange={e => setMetaAds(c => ({ ...c, accessToken: e.target.value }))}
            />
            <FieldHint>
              Meta Business Suite → Configuración → <strong>Usuarios del sistema</strong> → token con permiso <em>ads_read</em>.
            </FieldHint>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <TestButton
            onClick={() => void runTest("meta_ads", metaAds)}
            testing={tests.meta_ads.state === "testing"}
            disabled={!metaReady}
          />
          <TestMessage status={tests.meta_ads} />
        </div>
      </div>

      {/* ── Google Analytics 4 ── */}
      <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold text-orange-600">
            <span className="rounded-md bg-orange-100 p-1">
              <BarChart3 className="h-4 w-4" />
            </span>
            Google Analytics 4 (GA4)
          </h3>
          <StatusBadge status={tests.ga4} />
        </div>

        <div className="max-w-sm">
          <Label>Property ID</Label>
          <Input
            placeholder="123456789"
            value={ga4.propertyId}
            onChange={e => setGa4(c => ({ ...c, propertyId: e.target.value }))}
          />
          <FieldHint>
            Google Analytics → Admin (⚙️) → <strong>Propiedad</strong> → Configuración de la propiedad. Número de 9 dígitos.
          </FieldHint>
        </div>

        <div>
          <Label>Service Account (JSON)</Label>
          <Textarea
            rows={6}
            placeholder={
              ga4.serviceAccountConfigured
                ? "Ya hay una service account guardada. Pega un nuevo JSON solo para reemplazarla."
                : '{"type":"service_account","project_id":"…","private_key":"…","client_email":"…"}'
            }
            value={serviceAccountJson}
            onChange={e => setServiceAccountJson(e.target.value)}
            className="font-mono text-xs"
          />
          <FieldHint>
            En Google Cloud → IAM & Admin → <strong>Service Accounts</strong> → Create (o usa una existente) → Keys → Add key → Create new key JSON. Dale el rol <em>Viewer</em> (o <em>Analytics Data Viewer</em>) en la propiedad GA4.
          </FieldHint>
          {ga4.serviceAccountConfigured && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> Service account guardada. El JSON no se vuelve a mostrar.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <TestButton
            onClick={() =>
              void runTest("ga4", {
                propertyId: ga4.propertyId,
                ...(serviceAccountJson.trim() ? { serviceAccountJson } : {}),
              })
            }
            testing={tests.ga4.state === "testing"}
            disabled={!ga4Ready}
          />
          <TestMessage status={tests.ga4} />
        </div>

        <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">¿Qué métricas se importan?</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li><strong>Sesiones</strong> — visitas a tu sitio web</li>
            <li><strong>Usuarios</strong> y <strong>usuarios nuevos</strong></li>
            <li><strong>Canales de tráfico</strong> — orgánico, pagado, social, directo</li>
            <li><strong>Tasa de rebote</strong> — % que salió sin interactuar</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
