"use client";

import { useCallback, useEffect, useState } from "react";
import { Package, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AGENT_FICHA_KEY_PATTERN,
  AGENT_RULE_OPTIONS,
  type AgentFichaField,
  type AgentRules,
} from "@/lib/agent-config";

type Profile = {
  enabled: boolean;
  name: string;
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
  pipelineKeywords: string | null;
  fichaFields: AgentFichaField[];
  rules: AgentRules;
};

type KbEntry = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
};

export function AgentClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [kbSize, setKbSize] = useState<{ chars: number; warnAt: number; warning: boolean } | null>(null);
  const [catalogCount, setCatalogCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  const refetch = useCallback(async () => {
    const [p, kb, size, cat] = await Promise.all([
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb/size").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/catalog").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null, null, null]);
    if (p) {
      setProfile(p.profile);
      setAiConfigured(p.aiConfigured);
    }
    if (kb) setEntries(kb.entries);
    if (size) setKbSize(size);
    if (cat?.products) setCatalogCount(cat.products.length);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!profile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  async function saveProfile(patch: Partial<Profile>) {
    setSaveError("");
    const response = await fetch("/api/agent/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!response?.ok) {
      const data = await response?.json().catch(() => null) as { error?: { message?: string } } | null;
      setSaved(false);
      setSaveError(data?.error?.message ?? "No se pudo guardar la configuración del agente.");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    void refetch();
  }

  return (
    <div className="min-w-0">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">Agente de IA</h2>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-primary">Guardado ✓</span>}
          <span className="text-sm text-muted-foreground">
            {profile.enabled ? "Encendido" : "Apagado"}
          </span>
          <button
            role="switch"
            aria-checked={profile.enabled}
            aria-label="Agente encendido"
            disabled={!aiConfigured}
            onClick={() => void saveProfile({ enabled: !profile.enabled })}
            className={`relative h-6 w-11 rounded-full transition-colors after:absolute after:-inset-x-2 after:-inset-y-2 after:content-[''] disabled:opacity-40 ${
              profile.enabled ? "bg-brand" : "bg-border-strong"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-knob shadow-sm transition-transform ${
                profile.enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </header>

      <div className="space-y-4 p-4 sm:space-y-6 sm:p-6">
        {saveError && <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">{saveError}</p>}
        <div className="grid min-w-0 gap-4 sm:gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-4 sm:space-y-6">
            <ProfileSection profile={profile} onSave={saveProfile} />
            <AgentRulesSection rules={profile.rules} onSave={saveProfile} />
          </div>
          <div className="min-w-0 space-y-4 sm:space-y-6">
            <FichaFieldsSection fields={profile.fichaFields} onSave={saveProfile} />
            <KbSection entries={entries} kbSize={kbSize} catalogCount={catalogCount} strictKnowledgeBase={profile.rules.strictKnowledgeBase} onChanged={() => void refetch()} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileSection({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (patch: Partial<Profile>) => Promise<void>;
}) {
  const [form, setForm] = useState(profile);
  useEffect(() => setForm(profile), [profile]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comportamiento</CardTitle>
        <CardDescription>
          Cómo se presenta y actúa el agente al responder a tus clientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="agent-name">Nombre del agente</Label>
          <Input
            id="agent-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-tone">Tono</Label>
          <Input
            id="agent-tone"
            placeholder="p. ej. cercano y directo, con usted"
            value={form.tone ?? ""}
            onChange={(e) => setForm({ ...form, tone: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-instructions">Instrucciones</Label>
          <Textarea
            id="agent-instructions"
            rows={5}
            placeholder="Qué debe y no debe hacer el agente…"
            value={form.instructions ?? ""}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-escalation">Reglas de escalado</Label>
          <Textarea
            id="agent-escalation"
            rows={3}
            placeholder="Cuándo pasar la conversación a un humano…"
            value={form.escalationRules ?? ""}
            onChange={(e) => setForm({ ...form, escalationRules: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-pipeline-keywords">Palabras clave del pipeline</Label>
          <Textarea
            id="agent-pipeline-keywords"
            rows={3}
            placeholder={"cotización → Cotización\nperdido → Perdido\nganado → Cerrado"}
            value={form.pipelineKeywords ?? ""}
            onChange={(e) => setForm({ ...form, pipelineKeywords: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Cuando un cliente envíe estas palabras, el agente moverá el lead a la etapa indicada automáticamente. Una keyword por línea: <code>palabra → nombre de etapa</code>
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-greeting">Saludo</Label>
          <Input
            id="agent-greeting"
            placeholder="Saludo para conversaciones nuevas"
            value={form.greeting ?? ""}
            onChange={(e) => setForm({ ...form, greeting: e.target.value })}
          />
        </div>
        <Button className="min-h-11" onClick={() => void onSave(form)}>Guardar comportamiento</Button>
      </CardContent>
    </Card>
  );
}

function AgentRulesSection({
  rules,
  onSave,
}: {
  rules: AgentRules;
  onSave: (patch: Partial<Profile>) => Promise<void>;
}) {
  const [form, setForm] = useState(rules);
  useEffect(() => setForm(rules), [rules]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reglas del agente</CardTitle>
        <CardDescription>Activa o pausa las decisiones automáticas del modelo.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {AGENT_RULE_OPTIONS.map((rule) => (
          <label key={rule.key} className="flex min-w-0 items-start gap-3 rounded-md border p-3 transition-colors hover:bg-subtle">
            <input
              type="checkbox"
              checked={form[rule.key]}
              onChange={(event) => setForm({ ...form, [rule.key]: event.target.checked })}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{rule.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{rule.description}</span>
            </span>
          </label>
        ))}
        <Button className="min-h-11" onClick={() => void onSave({ rules: form })}>Guardar reglas</Button>
      </CardContent>
    </Card>
  );
}

function FichaFieldsSection({
  fields,
  onSave,
}: {
  fields: AgentFichaField[];
  onSave: (patch: Partial<Profile>) => Promise<void>;
}) {
  const [form, setForm] = useState(fields);
  useEffect(() => setForm(fields), [fields]);

  const keys = form.map((field) => field.key);
  const duplicateKeys = new Set(keys.filter((key, index) => keys.indexOf(key) !== index));
  const invalid = form.some((field) => !AGENT_FICHA_KEY_PATTERN.test(field.key) || !field.label.trim()) || duplicateKeys.size > 0;

  function updateField(index: number, patch: Partial<AgentFichaField>) {
    setForm((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
  }

  function addField() {
    let number = form.length + 1;
    let key = `campo_${number}`;
    while (form.some((field) => field.key === key)) {
      number += 1;
      key = `campo_${number}`;
    }
    setForm([...form, { key, label: `Campo ${number}` }]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campos de ficha</CardTitle>
        <CardDescription>Define qué datos recopila el agente en cada contacto. La clave se guarda en la ficha; la etiqueta se muestra aquí.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {form.map((field, index) => (
          <div key={`${field.key}-${index}`} className="grid min-w-0 grid-cols-1 items-end gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`ficha-label-${index}`}>Nombre del campo</Label>
              <Input
                id={`ficha-label-${index}`}
                value={field.label}
                maxLength={60}
                onChange={(event) => updateField(index, { label: event.target.value })}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`ficha-key-${index}`}>Clave técnica</Label>
              <Input
                id={`ficha-key-${index}`}
                value={field.key}
                maxLength={40}
                onChange={(event) => updateField(index, { key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                aria-invalid={!AGENT_FICHA_KEY_PATTERN.test(field.key) || duplicateKeys.has(field.key)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11 justify-self-end text-muted-foreground hover:text-destructive"
              aria-label={`Eliminar campo ${field.label}`}
              title={form.length === 1 ? "Mantén al menos un campo" : `Eliminar ${field.label}`}
              disabled={form.length === 1}
              onClick={() => setForm((current) => current.filter((_, fieldIndex) => fieldIndex !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {invalid && <p role="alert" className="text-xs text-danger-text">Corrige las claves duplicadas o inválidas antes de guardar.</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-11" onClick={addField} disabled={form.length >= 12}>
            <Plus className="h-4 w-4" /> Agregar campo
          </Button>
          <Button className="min-h-11" disabled={invalid} onClick={() => void onSave({ fichaFields: form })}>Guardar campos</Button>
        </div>
        <p className="text-xs text-muted-foreground">La clave usa minúsculas, números y guion bajo; por ejemplo, <code>presupuesto</code>.</p>
      </CardContent>
    </Card>
  );
}

function KbSection({
  entries,
  kbSize,
  catalogCount,
  strictKnowledgeBase,
  onChanged,
}: {
  entries: KbEntry[];
  kbSize: { chars: number; warnAt: number; warning: boolean } | null;
  catalogCount: number;
  strictKnowledgeBase: boolean;
  onChanged: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [block, setBlock] = useState("");

  async function addQa() {
    if (!question.trim() || !answer.trim()) return;
    await fetch("/api/kb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "qa", question, answer }),
    }).catch(() => null);
    setQuestion("");
    setAnswer("");
    onChanged();
  }

  async function addBlock() {
    if (!block.trim()) return;
    await fetch("/api/kb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "block", content: block }),
    }).catch(() => null);
    setBlock("");
    onChanged();
  }

  async function remove(id: string) {
    await fetch(`/api/kb/${id}`, { method: "DELETE" }).catch(() => null);
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Knowledge base</CardTitle>
            <CardDescription>
              {strictKnowledgeBase
                ? "Fuente de verdad del agente: si un dato no está aquí ni en el catálogo, no lo afirma."
                : "Referencia del negocio que el agente utiliza para responder."}
            </CardDescription>
          </div>
          {kbSize && (
            <Badge variant={kbSize.warning ? "warning" : "secondary"}>
              {kbSize.chars.toLocaleString("es-MX")} caracteres
            </Badge>
          )}
        </div>
        {kbSize?.warning && (
          <p className="text-xs text-warning-text">
            El conocimiento se acerca al límite del contexto del modelo (v1 lo
            inyecta completo en cada turno). Considera depurar entradas.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {catalogCount > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-brand-soft bg-brand-tint p-3 text-sm">
            <Package className="h-4 w-4 text-primary shrink-0" />
            <span>
              El bot conoce automáticamente <strong>{catalogCount}</strong> {catalogCount === 1 ? "producto del" : "productos del"} catálogo.
            </span>
          </div>
        )}

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nueva pregunta / respuesta</p>
          <Input
            placeholder="Pregunta (p. ej. ¿Hacen envíos?)"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Textarea
            placeholder="Respuesta"
            rows={2}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <Button
            size="sm"
            className="min-h-11"
            onClick={() => void addQa()}
            disabled={!question.trim() || !answer.trim()}
          >
            <Plus className="h-4 w-4" /> Agregar P/R
          </Button>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nuevo bloque de texto libre</p>
          <Textarea
            placeholder="Horarios, direcciones, políticas…"
            rows={3}
            value={block}
            onChange={(e) => setBlock(e.target.value)}
          />
          <Button size="sm" className="min-h-11" onClick={() => void addBlock()} disabled={!block.trim()}>
            <Plus className="h-4 w-4" /> Agregar bloque
          </Button>
        </div>

        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-2 rounded-md border p-3">
              <div className="min-w-0 flex-1 text-sm">
                {e.kind === "qa" ? (
                  <>
                    <p className="font-medium">{e.question}</p>
                    <p className="mt-0.5 text-muted-foreground">{e.answer}</p>
                  </>
                ) : (
                  <p className="whitespace-pre-wrap text-muted-foreground">{e.content}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Eliminar entrada"
                onClick={() => void remove(e.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
          {entries.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">
              Sin entradas todavía: agrega lo que el agente debe saber.
            </p>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
