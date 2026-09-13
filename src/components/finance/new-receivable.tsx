"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ContactPicker } from "@/components/contact-picker";
export function NewReceivable({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [concept, setConcept] = useState(""); const [amount, setAmount] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [date, setDate] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"><form className="w-full max-w-md space-y-3 rounded-lg border bg-card p-5" onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    const res = await fetch("/api/finances/receivables", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ concept, totalAmount: Math.round(Number(amount) * 100), contactId, dueDate: date ? new Date(`${date}T12:00:00Z`).toISOString() : undefined }) }).catch(() => null);
    setBusy(false); if (res?.ok) onSaved(); else setError((await res?.json())?.error?.message ?? "No se pudo guardar");
  }}><h3 className="font-semibold">Nueva cuenta por cobrar</h3>
    <label className="block">Concepto<Input required value={concept} onChange={(e) => setConcept(e.target.value)} /></label>
    <label className="block">Importe (MXN)<Input required type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
    <ContactPicker value={contactId} onChange={setContactId} />
    <label className="block">Vencimiento<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex gap-2"><Button disabled={busy} type="submit">Guardar cuenta</Button><Button disabled={busy} type="button" variant="outline" onClick={onClose}>Cancelar</Button></div>
  </form></div>;
}
