"use client";
import { useEffect, useId, useState } from "react";
import { taskRequest } from "@/components/tasks/api";

export type CrmMember = { userId: string; name: string; email: string };

export function MemberPicker({ value, onChange, members, disabled, label = "Responsable", emptyLabel = "Sin asignar" }: {
  value: string | null; onChange: (userId: string | null) => void; members?: CrmMember[]; disabled?: boolean; label?: string; emptyLabel?: string;
}) {
  const [loaded, setLoaded] = useState<CrmMember[]>([]);
  const id = useId();
  const [error, setError] = useState("");
  useEffect(() => {
    if (members) return;
    const controller = new AbortController();
    taskRequest<{ members: CrmMember[] }>("/api/members", { signal: controller.signal })
      .then((data) => setLoaded(data.members)).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [members]);
  const choices = members ?? loaded;
  return <div className="text-sm"><label htmlFor={id}>{label}</label>
    <select id={id} className="mt-1 w-full rounded-md border bg-background p-2" disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {value && !choices.some((m) => m.userId === value) && <option value={value}>Miembro no disponible</option>}
      {choices.map((m) => <option key={m.userId} value={m.userId}>{m.name || m.email}</option>)}
    </select>
    {error && <span role="alert" className="text-destructive">{error}</span>}
  </div>;
}
