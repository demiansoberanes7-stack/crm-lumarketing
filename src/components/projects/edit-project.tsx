"use client";
import { useState } from "react";
import { ContactPicker } from "@/components/contact-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MemberPicker } from "@/components/member-picker";
export function EditProject({ project, onSaved, onCancel }: {
  project: { id: string; name: string; contactId: string | null; service: string | null; estado: string; prioridad: string | null; notas?: string | null; riesgo: string | null; assignedUserId: string | null };
  onSaved: () => void; onCancel: () => void;
}) {
  const [form, setForm] = useState({ name: project.name, contactId: project.contactId, service: project.service ?? "", estado: project.estado, prioridad: project.prioridad, notas: project.notas ?? "", riesgo: project.riesgo, assignedUserId: project.assignedUserId });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="space-y-3 rounded-lg border p-4" onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    const res = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }).catch(() => null);
    setBusy(false);
    if (res?.ok) onSaved(); else setError((await res?.json())?.error?.message ?? "No se pudo guardar el proyecto");
  }}>
    <h3 className="font-semibold">Editar proyecto</h3>
    <label className="block">Nombre<Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
    <label className="block">Servicio<Input value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} /></label>
    <ContactPicker value={form.contactId} onChange={(contactId) => setForm({ ...form, contactId })} />
    <MemberPicker value={form.assignedUserId} onChange={(assignedUserId) => setForm({ ...form, assignedUserId })} disabled={busy} />
    <label className="block">Riesgo <select value={form.riesgo ?? ""} onChange={(e) => setForm({ ...form, riesgo: e.target.value || null })} className="rounded border bg-background p-2"><option value="">Sin riesgo definido</option><option value="bajo">Bajo</option><option value="medio">Medio</option><option value="alto">Alto</option></select></label>
    <label className="block">Estado <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} className="rounded border bg-background p-2"><option value="activo">Activo</option><option value="reunion">Reunión</option><option value="cerrado">Cerrado</option></select></label>
    <label className="block">Prioridad <select value={form.prioridad ?? ""} onChange={(e) => setForm({ ...form, prioridad: e.target.value || null })} className="rounded border bg-background p-2"><option value="">Sin prioridad</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select></label>
    <label className="block">Notas<textarea rows={3} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex gap-2"><Button disabled={busy} type="submit">{busy ? "Guardando…" : "Guardar cambios"}</Button><Button disabled={busy} variant="outline" type="button" onClick={onCancel}>Cancelar</Button></div>
  </form>;
}
