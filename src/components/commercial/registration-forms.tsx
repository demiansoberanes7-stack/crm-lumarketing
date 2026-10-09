"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = { onSaved: () => void };

function pesosToCents(v: string): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const inputCls = "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm";

export function CampaignForm({ onSaved }: Props) {
  const [f, setF] = useState({ name: "", platform: "meta", budget: "", objective: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setError(null);
    if (!f.name.trim()) return setError("Nombre requerido");
    const cents = f.budget ? pesosToCents(f.budget) : null;
    if (f.budget && cents == null) return setError("Inversión inválida");
    setSaving(true);
    try {
      const res = await fetch("/api/commercial/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: f.name, platform: f.platform, budgetPlannedCents: cents, objective: f.objective || null }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(j?.error?.message ?? `No se pudo guardar (${res.status})`);
        return;
      }
      setF({ name: "", platform: "meta", budget: "", objective: "" });
      onSaved();
    } catch {
      setError("Error de red");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <h4 className="mb-3 text-sm font-semibold">Registrar campaña</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">Nombre
          <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Campaña verano" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">Plataforma
          <select className={inputCls} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>
            <option value="meta">Meta Ads</option>
            <option value="google">Google Ads</option>
            <option value="tiktok">TikTok Ads</option>
            <option value="other">Otra</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">Inversión planeada (MXN)
          <input className={inputCls} value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} placeholder="5000" inputMode="decimal" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">Objetivo
          <input className={inputCls} value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} placeholder="Ventas / Leads" />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <Button size="sm" className="mt-3" onClick={submit} disabled={saving}>
        {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null} Guardar campaña
      </Button>
    </div>
  );
}

export function ServiceCostForm({ onSaved }: Props) {
  const [f, setF] = useState({ name: "", service: "", cost: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setError(null);
    if (!f.name.trim()) return setError("Nombre requerido");
    const cents = pesosToCents(f.cost || "0");
    if (cents == null) return setError("Costo inválido");
    setSaving(true);
    try {
      const res = await fetch("/api/commercial/service-costs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: f.name, service: f.service || null, costCents: cents }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(j?.error?.message ?? `No se pudo guardar (${res.status})`);
        return;
      }
      setF({ name: "", service: "", cost: "" });
      onSaved();
    } catch {
      setError("Error de red");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <h4 className="mb-3 text-sm font-semibold">Registrar costo de prestación</h4>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-muted-foreground">Nombre
          <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Impresión X" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">Servicio
          <input className={inputCls} value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} placeholder="Diseño" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">Costo (MXN)
          <input className={inputCls} value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="1200" inputMode="decimal" />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <Button size="sm" className="mt-3" onClick={submit} disabled={saving}>
        {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null} Guardar costo
      </Button>
    </div>
  );
}

export function MarketplaceOrderForm({ onSaved }: Props) {
  const [f, setF] = useState({ orderNumber: "", itemName: "", amount: "", quantity: "1" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setError(null);
    if (!f.orderNumber.trim()) return setError("Número de orden requerido");
    if (!f.itemName.trim()) return setError("Producto requerido");
    const cents = pesosToCents(f.amount || "0");
    if (cents == null) return setError("Monto inválido");
    setSaving(true);
    try {
      const res = await fetch("/api/commercial/marketplace-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderNumber: f.orderNumber, itemName: f.itemName, amountCents: cents, quantity: Number(f.quantity) || 1 }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(j?.error?.message ?? `No se pudo guardar (${res.status})`);
        return;
      }
      setF({ orderNumber: "", itemName: "", amount: "", quantity: "1" });
      onSaved();
    } catch {
      setError("Error de red");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <h4 className="mb-3 text-sm font-semibold">Registrar venta de Marketplace</h4>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-xs text-muted-foreground">Orden
          <input className={inputCls} value={f.orderNumber} onChange={(e) => setF({ ...f, orderNumber: e.target.value })} placeholder="123-456" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">Producto
          <input className={inputCls} value={f.itemName} onChange={(e) => setF({ ...f, itemName: e.target.value })} placeholder="Playera X" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">Monto (MXN)
          <input className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="899" inputMode="decimal" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">Cant.
          <input className={inputCls} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} inputMode="numeric" />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <Button size="sm" className="mt-3" onClick={submit} disabled={saving}>
        {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null} Guardar orden
      </Button>
    </div>
  );
}
