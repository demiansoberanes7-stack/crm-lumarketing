"use client";

import { useState, type FormEvent } from "react";
import type { StageDto } from "@/lib/types";
import { parseMoneyToCents } from "@/lib/money";
import { ContactPicker } from "@/components/contact-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewLeadDialog({
  stages,
  currency,
  onClose,
  onCreated,
}: {
  stages: StageDto[];
  currency: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const availableStages = stages.filter(
    (stage) => stage.kind === "open" || stage.kind === "qualified"
  );
  const [contactId, setContactId] = useState<string | null>(null);
  const [stageId, setStageId] = useState(
    () =>
      availableStages.find((stage) => stage.kind === "open")?.id ??
      availableStages[0]?.id ??
      ""
  );
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const parsedAmount = amount.trim() ? parseMoneyToCents(amount) : null;
  const invalidAmount = amount.trim().length > 0 && parsedAmount === null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactId || !stageId || invalidAmount || saving) return;

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/pipeline/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          stageId,
          amountCents: parsedAmount,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setError(data?.error?.message ?? "No se pudo crear el prospecto. Intenta de nuevo.");
        return;
      }
      onCreated();
    } catch {
      setError("No se pudo crear el prospecto. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-overlay p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Nuevo prospecto"
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="my-auto max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-lg border bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-pop"
      >
        <h3 className="font-semibold">Nuevo prospecto</h3>

        <div className="mt-4">
          <ContactPicker value={contactId} onChange={setContactId} />
        </div>

        <label className="mt-4 block text-sm font-medium" htmlFor="new-lead-stage">
          Etapa
        </label>
        <select
          id="new-lead-stage"
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={stageId}
          onChange={(event) => setStageId(event.target.value)}
          required
        >
          {availableStages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
        {availableStages.length === 0 && (
          <p className="mt-1 text-xs text-danger-text">No hay etapas disponibles para prospectos nuevos.</p>
        )}

        <label className="mt-4 block text-sm font-medium" htmlFor="new-lead-amount">
          Monto opcional ({currency})
        </label>
        <Input
          id="new-lead-amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          placeholder="12,500.00"
          className="mt-1"
        />
        {invalidAmount && (
          <p className="mt-1 text-xs text-danger-text">
            No reconozco ese número. Escríbelo como 12500 o 12,500.00
          </p>
        )}

        {error && (
          <p className="mt-3 text-sm text-danger-text" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!contactId || !stageId || invalidAmount || saving}>
            {saving ? "Guardando…" : "Crear prospecto"}
          </Button>
        </div>
      </form>
    </div>
  );
}
