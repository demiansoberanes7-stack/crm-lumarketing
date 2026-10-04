"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Clock, GitBranch, MessageSquareMore, Play, RefreshCw,
  ToggleLeft, ToggleRight, Zap, Edit2, Save, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  messageText: string;
  delayHours: number;
  enabled: boolean;
  channel: "whatsapp" | "email";
}

interface ConversationOption {
  id: string;
  channel: string;
  contact: { name: string; phone: string | null };
  stageName: string | null;
}

type DelayUnit = "hours" | "days";
interface AutomationMetrics {
  activeFlows: number;
  sent: number;
  eligible: number;
  responded: number;
  responseRate: number;
  periodDays: number;
  responseWindowDays: number;
  schedulerReady: boolean;
}

function describeDelay(hours: number): string {
  if (hours === 0) return "sin espera";
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} ${days === 1 ? "día" : "días"} de espera`;
  }
  return `${hours} ${hours === 1 ? "hora" : "horas"} de espera`;
}

const PRESET_RULES: AutomationRule[] = [
  {
    id: "followup-3d",
    name: "Seguimiento automático",
    trigger: "Lead pasa a etapa «Cotizado» o no hay actividad",
    messageText: "Hola, espero que estés teniendo un excelente día. Solo quería dar seguimiento a nuestra conversación anterior. ¿Tienes alguna duda con la cotización?",
    delayHours: 72,
    enabled: true,
    channel: "whatsapp",
  },
  {
    id: "followup-7d",
    name: "Segundo seguimiento final",
    trigger: "Sin respuesta tras primer seguimiento",
    messageText: "¡Hola! Te escribo rápidamente por si se te traspapeló mi mensaje anterior. Si ya no te interesa el servicio, no te preocupes, solo dime para no insistir. ¡Saludos!",
    delayHours: 168,
    enabled: false,
    channel: "whatsapp",
  },
  {
    id: "welcome",
    name: "Bienvenida automática",
    trigger: "Nuevo lead entra al pipeline",
    messageText: "¡Hola! Gracias por contactarnos. En un momento uno de nuestros agentes te atenderá de forma personalizada.",
    delayHours: 0,
    enabled: false,
    channel: "whatsapp",
  },
];

const statusColors: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-600 border-emerald-200",
  inactive: "bg-zinc-500/10 text-zinc-500 border-zinc-200",
};

export function AutomationsClient() {
  const [rules, setRules] = useState<AutomationRule[]>(PRESET_RULES);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<AutomationRule>>({});
  const [editDelayValue, setEditDelayValue] = useState("3");
  const [editDelayUnit, setEditDelayUnit] = useState<DelayUnit>("days");

  const [testConvId, setTestConvId] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [manualIdEnabled, setManualIdEnabled] = useState(false);
  const [conversations, setConversations] = useState<ConversationOption[]>([]);
  const [conversationsError, setConversationsError] = useState("");
  const [manualDelayValue, setManualDelayValue] = useState("3");
  const [manualDelayUnit, setManualDelayUnit] = useState<DelayUnit>("days");
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string; } | null>(null);
  const [metrics, setMetrics] = useState<AutomationMetrics | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [saveError, setSaveError] = useState("");

  const refetchMetrics = useCallback(async () => {
    const response = await fetch("/api/automations/metrics").catch(() => null);
    if (!response?.ok) return;
    const data = (await response.json()) as { metrics?: AutomationMetrics };
    if (data.metrics) setMetrics(data.metrics);
  }, []);

  useEffect(() => { void refetchMetrics(); }, [refetchMetrics]);

  useEffect(() => {
    fetch("/api/automations/rules")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.rules && Array.isArray(d.rules)) {
          // Merge preset with db rules
          const mergedRules = PRESET_RULES.map(pr => {
            const dr = d.rules.find((r: AutomationRule) => r.id === pr.id);
            return dr ? { ...pr, ...dr } : pr;
          });
          setRules(mergedRules);
          const followUp = mergedRules.find((rule) => rule.id === "followup-3d");
          if (followUp) {
            const inDays = followUp.delayHours % 24 === 0;
            setManualDelayUnit(inDays ? "days" : "hours");
            setManualDelayValue(String(inDays ? followUp.delayHours / 24 : followUp.delayHours));
          }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/conversations")
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudieron cargar las conversaciones");
        return response.json() as Promise<{ conversations?: ConversationOption[] }>;
      })
      .then((data) => setConversations(Array.isArray(data.conversations) ? data.conversations : []))
      .catch(() => setConversationsError("No se pudieron cargar los contactos activos."));
  }, []);

  async function persistRules(newRules: AutomationRule[]): Promise<boolean> {
    setSavingRules(true);
    setSaveError("");
    try {
      const response = await fetch("/api/automations/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rules: newRules }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        setSaveError(data?.error?.message ?? "No se pudieron guardar las reglas.");
        return false;
      }
      void refetchMetrics();
      return true;
    } catch {
      setSaveError("No se pudieron guardar las reglas por un error de red.");
      return false;
    } finally {
      setSavingRules(false);
    }
  }

  async function toggleRule(id: string) {
    const newRules = rules.map((rule) => rule.id === id ? { ...rule, enabled: !rule.enabled } : rule);
    setRules(newRules);
    if (!await persistRules(newRules)) setRules(rules);
  }

  function startEdit(rule: AutomationRule) {
    setEditingId(rule.id);
    setEditForm({ ...rule });
    const inDays = rule.delayHours % 24 === 0;
    setEditDelayUnit(inDays ? "days" : "hours");
    setEditDelayValue(String(inDays ? rule.delayHours / 24 : rule.delayHours));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
  }

  async function saveEdit() {
    if (!editingId) return;
    const newRules = rules.map(rule => {
      if (rule.id === editingId) {
        return {
          ...rule,
          name: editForm.name ?? rule.name,
          delayHours: Math.min(8760, Math.max(0, Math.round(Number(editDelayValue) || 0) * (editDelayUnit === "days" ? 24 : 1))),
          messageText: editForm.messageText ?? rule.messageText,
          channel: editForm.channel ?? rule.channel,
        };
      }
      return rule;
    });
    if (await persistRules(newRules)) {
      setRules(newRules);
      cancelEdit();
    }
  }

  async function triggerManual() {
    const conversationId = manualIdEnabled ? testConvId.trim() : selectedConversationId;
    if (!conversationId) return;
    setTriggering(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/automations/followup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          delayHours: Math.min(
            8760,
            Math.max(0, Math.round(Number(manualDelayValue) || 0) * (manualDelayUnit === "days" ? 24 : 1))
          ),
        }),
      });
      const data = (await res.json()) as { ok: boolean; executionId?: string; error?: string };
      if (data.ok) {
        setTestResult({ ok: true, msg: `Seguimiento programado: ${data.executionId}` });
      } else {
        setTestResult({ ok: false, msg: data.error ?? "Error al iniciar workflow" });
      }
    } catch {
      setTestResult({ ok: false, msg: "Error de red" });
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-background/50 text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Automatizaciones</h1>
          <p className="text-sm text-muted-foreground">
            Flujos de trabajo automáticos para seguimiento y retargeting de leads
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-3 py-1.5">
          <span className={`h-2 w-2 rounded-full ${metrics?.schedulerReady ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
          <span className="text-xs font-medium text-muted-foreground">Programador {metrics?.schedulerReady ? "activo" : "iniciando"}</span>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6 space-y-8">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Flujos activos", value: metrics?.activeFlows ?? rules.filter(r => r.enabled).length, icon: Zap, color: "text-brand" },
            { label: "Enviados · últimos 30 días", value: metrics?.sent ?? "—", icon: MessageSquareMore, color: "text-blue-500" },
            { label: "Tasa de respuesta · 7 días", value: metrics ? `${metrics.responseRate}%` : "—", icon: RefreshCw, color: "text-emerald-500" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm">
              <div className={`rounded-lg bg-muted p-2.5 ${color}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
          ))}
        </div>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Reglas de automatización
          </h2>
          {saveError && <p role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{saveError}</p>}
          <div className="space-y-4">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md overflow-hidden">
                {editingId === rule.id ? (
                  <div className="p-5 space-y-4 bg-muted/20">
                    <div className="flex justify-between items-center mb-2">
                      <h3 className="font-semibold text-sm">Editando Regla</h3>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={cancelEdit}><X className="h-4 w-4 mr-1"/> Cancelar</Button>
                        <Button size="sm" onClick={() => void saveEdit()} disabled={savingRules}><Save className="h-4 w-4 mr-1"/> Guardar</Button>
                      </div>
                    </div>
                    
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Nombre / Título</label>
                        <Input 
                          value={editForm.name ?? ""} 
                          onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                       <label className="text-xs font-medium text-muted-foreground">Tiempo de espera (inactividad)</label>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            max={editDelayUnit === "days" ? 365 : 8760}
                            value={editDelayValue}
                            onChange={(e) => setEditDelayValue(e.target.value)}
                          />
                          <select
                            className="h-10 rounded-md border bg-background px-3 text-sm"
                            value={editDelayUnit}
                            onChange={(e) => setEditDelayUnit(e.target.value as DelayUnit)}
                            aria-label="Unidad del tiempo de espera"
                          >
                            <option value="hours">Horas</option>
                            <option value="days">Días</option>
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground" htmlFor={`channel-${rule.id}`}>Canal de envío</label>
                        <select
                          id={`channel-${rule.id}`}
                          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                          value={editForm.channel ?? rule.channel}
                          onChange={e => setEditForm({ ...editForm, channel: e.target.value as AutomationRule["channel"] })}
                        >
                          <option value="whatsapp">WhatsApp</option>
                          <option value="email">Correo electrónico</option>
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Mensaje Automático</label>
                      <Textarea 
                        rows={3}
                        value={editForm.messageText ?? ""} 
                        onChange={e => setEditForm({ ...editForm, messageText: e.target.value })}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start relative group">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                      <GitBranch className="h-5 w-5" />
                    </div>

                    <div className="flex-1 min-w-0 pr-12 sm:pr-0">
                      <div className="flex items-center gap-3 mb-1">
                        <p className="font-semibold text-sm">{rule.name}</p>
                        <span className={`hidden sm:inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${rule.enabled ? statusColors.active : statusColors.inactive}`}>
                          {rule.enabled ? "Activo" : "Inactivo"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mb-3">
                        <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-orange-400" />{rule.trigger}</span>
                         <span className="flex items-center gap-1"><Clock className="h-3 w-3 text-blue-400" />{describeDelay(rule.delayHours)}</span>
                        <span>{rule.channel === "email" ? "Correo" : "WhatsApp"}</span>
                      </div>
                      <div className="bg-muted/40 p-3 rounded-lg text-sm italic border-l-2 border-brand/50">
                        “{rule.messageText}”
                      </div>
                    </div>

                    <div className="absolute right-4 top-4 sm:relative sm:top-0 sm:right-0 flex items-center gap-2">
                      <Button size="icon" variant="ghost" onClick={() => startEdit(rule)} aria-label={`Editar ${rule.name}`} className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <button onClick={() => void toggleRule(rule.id)} disabled={savingRules} className="text-muted-foreground transition-colors hover:text-foreground" aria-label={rule.enabled ? "Desactivar" : "Activar"}>
                        {rule.enabled ? <ToggleRight className="h-7 w-7 text-brand" /> : <ToggleLeft className="h-7 w-7" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border bg-card shadow-sm">
          <div className="flex items-center gap-3 border-b px-5 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
              <Play className="h-4 w-4" />
            </div>
            <div>
              <p className="font-semibold text-sm">Disparar manualmente</p>
              <p className="text-xs text-muted-foreground">Inicia un seguimiento ahora para cualquier conversación</p>
            </div>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="conversation-picker">Contacto / conversación</label>
                {manualIdEnabled ? (
                  <Input placeholder="ID de conversación para pruebas técnicas" value={testConvId} onChange={e => setTestConvId(e.target.value)} />
                ) : (
                  <select
                    id="conversation-picker"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={selectedConversationId}
                    onChange={e => setSelectedConversationId(e.target.value)}
                  >
                    <option value="">{conversations.length ? "Selecciona una conversación" : "No hay conversaciones activas"}</option>
                    {conversations.map((conversation) => (
                      <option key={conversation.id} value={conversation.id}>
                        {conversation.contact.name} · {conversation.contact.phone || "Sin teléfono"} · {conversation.stageName || "Sin etapa"}
                      </option>
                    ))}
                  </select>
                )}
                {conversationsError && !manualIdEnabled && <p className="text-xs text-destructive">{conversationsError}</p>}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={manualIdEnabled} onChange={e => setManualIdEnabled(e.target.checked)} />
                  Ingresar ID manual (pruebas técnicas)
                </label>
              </div>
              <div className="space-y-1.5">
                 <label className="text-xs font-medium text-muted-foreground">Esperar</label>
                 <div className="flex gap-2">
                   <Input type="number" min={0} step={1} value={manualDelayValue} onChange={e => setManualDelayValue(e.target.value)} />
                   <select className="h-10 rounded-md border bg-background px-3 text-sm" value={manualDelayUnit} onChange={e => setManualDelayUnit(e.target.value as DelayUnit)} aria-label="Unidad de espera manual">
                     <option value="hours">Horas</option>
                     <option value="days">Días</option>
                   </select>
                 </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button disabled={triggering || (manualIdEnabled ? !testConvId.trim() : !selectedConversationId)} onClick={() => void triggerManual()}>
                {triggering ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Iniciando…</> : <><Play className="mr-2 h-4 w-4" /> Iniciar flujo</>}
              </Button>
               {testResult && <span className={`text-sm font-medium ${testResult.ok ? "text-emerald-600" : "text-amber-600"}`}>{testResult.msg}</span>}
            </div>
            {metrics && <p className="text-xs text-muted-foreground">{metrics.responded} respuestas de {metrics.eligible} seguimientos con 7 días completos para responder, dentro de los últimos 30 días.</p>}
          </div>
        </section>
      </main>
    </div>
  );
}
