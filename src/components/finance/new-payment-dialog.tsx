"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface NewPaymentDialogProps {
  onClose: () => void;
  onSaved: () => void;
}

export function NewPaymentDialog({ onClose, onSaved }: NewPaymentDialogProps) {
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("Efectivo");
  const [referencia, setReferencia] = useState("");
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!monto || Number(monto) <= 0) return;
    setSaving(true);
    const res = await fetch("/api/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        monto: Math.round(Number(monto) * 100),
        metodo,
        referencia: referencia.trim() || undefined,
        notas: notas.trim() || undefined,
      }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-semibold">Registrar Pago</h3>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="payment-monto">Monto (MXN)</Label>
            <Input
              id="payment-monto"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payment-metodo">Método de pago</Label>
            <select
              id="payment-metodo"
              value={metodo}
              onChange={(e) => setMetodo(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              <option value="Efectivo">Efectivo</option>
              <option value="Transferencia">Transferencia</option>
              <option value="Tarjeta">Tarjeta</option>
              <option value="Depósito">Depósito</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payment-referencia">Referencia</Label>
            <Input
              id="payment-referencia"
              placeholder="Opcional"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payment-notas">Notas</Label>
            <Textarea
              id="payment-notas"
              rows={3}
              placeholder="Opcional"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!monto || Number(monto) <= 0 || saving} onClick={() => void handleSave()}>
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
