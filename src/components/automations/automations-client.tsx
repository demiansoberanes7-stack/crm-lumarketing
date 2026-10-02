"use client";

import { useState } from "react";
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
}

const PRESET_RULES: AutomationRule[] = [
  {
    id: "followup-3d",
    name: "Seguimiento automático",
    trigger: "Lead pasa a etapa «Cotizado» o no hay actividad",
    messageText: "Hola, espero que estés teniendo un excelente día. Solo quería dar seguimiento a nuestra conversación anterior. ¿Tienes alguna duda con la cotización?",
    delayHours: 72,
    enabled: true,
  },
  {
    id: "followup-7d",
    name: "Segundo seguimiento final",
    trigger: "Sin respuesta tras primer seguimiento",
    messageText: "¡Hola! Te escribo rápidamente por si se te traspapeló mi mensaje anterior. Si ya no te interesa el servicio, no te preocupes, solo dime para no insistir. ¡Saludos!",
    delayHours: 168,
    enabled: false,
  },
  {
    id: "welcome",
    name: "Bienvenida automática",
    trigger: "Nuevo lead entra al pipeline",
    messageText: "¡Hola! Gracias por contactarnos. En un momento uno de nuestros agentes te atenderá de forma personalizada.",
    delayHours: 0,
    enabled: false,
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

  const [testConvId, setTestConvId] = useState("");
  const [testDelayH, setTestDelayH] = useState("72");
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string; } | null>(null);
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    fetch("/api/automations/rules")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.rules && Array.isArray(d.rules)) {
          // Merge preset with db rules
          setRules(PRESET_RULES.map(pr => {
            const dr = d.rules.find((r: AutomationRule) => r.id === pr.id);
            return dr ? { ...pr, ...dr } : pr;
          }));
        }
      })
      .catch(() => {});
  }, []);

  async function persistRules(newRules: AutomationRule[]) {
    await fetch("/api/automations/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rules: newRules })
    });
  }

  function toggleRule(id: string) {
    const newRules = rules.map((rule) => rule.id === id ? { ...rule, enabled: !rule.enabled } : rule);
    setRules(newRules);
    void persistRules(newRules);
  }

  function startEdit(rule: AutomationRule) {
    setEditingId(rule.id);
    setEditForm({ ...rule });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
  }

  function saveEdit() {
    if (!editingId) return;
    const newRules = rules.map(rule => {
      if (rule.id === editingId) {
        return {
          ...rule,
          name: editForm.name ?? rule.name,
          delayHours: editForm.delayHours ?? rule.delayHours,
          messageText: editForm.messageText ?? rule.messageText
        };
      }
      return rule;
    });
    setRules(newRules);
    void persistRules(newRules);
    cancelEdit();
  }

  async function triggerManual() {
    if (!testConvId.trim()) return;
    setTriggering(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/automations/followup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: testConvId.trim(),
          delayHours: Number(testDelayH) || 72,
        }),
      });
      const data = (await res.json()) as { ok: boolean; workflowId?: string; error?: string };
      if (data.ok) {
        setTestResult({ ok: true, msg: `Workflow iniciado: ${data.workflowId}` });
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
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-medium text-muted-foreground">Motor Temporal</span>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6 space-y-8">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Flujos activos", value: rules.filter(r => r.enabled).length, icon: Zap, color: "text-brand" },
            { label: "Seguimientos enviados", value: "24", icon: MessageSquareMore, color: "text-blue-500" },
            { label: "Tasa de respuesta", value: "34%", icon: RefreshCw, color: "text-emerald-500" },
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
          <div className="space-y-4">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md overflow-hidden">
                {editingId === rule.id ? (
                  <div className="p-5 space-y-4 bg-muted/20">
                    <div className="flex justify-between items-center mb-2">
                      <h3 className="font-semibold text-sm">Editando Regla</h3>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={cancelEdit}><X className="h-4 w-4 mr-1"/> Cancelar</Button>
                        <Button size="sm" onClick={saveEdit}><Save className="h-4 w-4 mr-1"/> Guardar</Button>
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
                        <label className="text-xs font-medium text-muted-foreground">Días de espera (inactividad)</label>
                        <Input 
                          type="number" 
                          min={0}
                          value={(editForm.delayHours ?? 0) / 24} 
                          onChange={e => setEditForm({ ...editForm, delayHours: Number(e.target.value) * 24 })}
                        />
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
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3 text-blue-400" />{rule.delayHours / 24} {rule.delayHours === 24 ? "día" : "días"} de espera</span>
                      </div>
                      <div className="bg-muted/40 p-3 rounded-lg text-sm italic border-l-2 border-brand/50">
                        "{rule.messageText}"
                      </div>
                    </div>

                    <div className="absolute right-4 top-4 sm:relative sm:top-0 sm:right-0 flex items-center gap-2">
                      <Button size="icon" variant="ghost" onClick={() => startEdit(rule)} className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <button onClick={() => toggleRule(rule.id)} className="text-muted-foreground transition-colors hover:text-foreground" aria-label={rule.enabled ? "Desactivar" : "Activar"}>
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
                <label className="text-xs font-medium text-muted-foreground">ID de conversación</label>
                <Input placeholder="cv_xxxxxxxxxxxxxxxx" value={testConvId} onChange={e => setTestConvId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Esperar (horas)</label>
                <Input type="number" min={0} step={1} placeholder="72" value={testDelayH} onChange={e => setTestDelayH(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button disabled={triggering || !testConvId.trim()} onClick={() => void triggerManual()}>
                {triggering ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Iniciando…</> : <><Play className="mr-2 h-4 w-4" /> Iniciar flujo</>}
              </Button>
              {testResult && <span className={`text-sm font-medium ${testResult.ok ? "text-emerald-600" : "text-amber-600"}`}>{testResult.msg}</span>}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
