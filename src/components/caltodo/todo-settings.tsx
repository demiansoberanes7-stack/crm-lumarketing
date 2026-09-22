"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings, Clock, Loader2, Save } from "lucide-react";

type SettingsData = { workStartHour: number; workEndHour: number; timezone: string; defaultDuration: number } | null;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const TIMEZONES = ["America/Mexico_City", "America/New_York", "America/Los_Angeles", "America/Chicago", "America/Bogota", "America/Lima", "America/Buenos_Aires", "Europe/Madrid", "Europe/London", "UTC"];
const DURATIONS = [
  { value: "15", label: "15 min" }, { value: "30", label: "30 min" }, { value: "60", label: "1 hora" },
  { value: "90", label: "1.5 horas" }, { value: "120", label: "2 horas" },
];

export function TodoSettings({ initial, onSave }: { initial: SettingsData; onSave: (data: Record<string, unknown>) => Promise<void> }) {
  const [workStart, setWorkStart] = useState(String(initial?.workStartHour ?? 9));
  const [workEnd, setWorkEnd] = useState(String(initial?.workEndHour ?? 17));
  const [tz, setTz] = useState(initial?.timezone ?? "America/Mexico_City");
  const [dur, setDur] = useState(String(initial?.defaultDuration ?? 60));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    await onSave({ workStartHour: Number(workStart), workEndHour: Number(workEnd), timezone: tz, defaultDuration: Number(dur) });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" /> Configuración</CardTitle>
        <CardDescription>Horario laboral, timezone y duración por defecto</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="flex items-center gap-2 mb-1 text-sm font-medium"><Clock className="h-4 w-4" /> Inicio</label>
            <select value={workStart} onChange={(e) => setWorkStart(e.target.value)} className="w-full rounded border bg-background p-2 text-sm">
              {HOURS.map((h) => <option key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 mb-1 text-sm font-medium"><Clock className="h-4 w-4" /> Fin</label>
            <select value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} className="w-full rounded border bg-background p-2 text-sm">
              {HOURS.map((h) => <option key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Zona horaria</label>
          <select value={tz} onChange={(e) => setTz(e.target.value)} className="w-full rounded border bg-background p-2 text-sm">
            {TIMEZONES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium">Duración por defecto</label>
          <div className="flex flex-wrap gap-3">
            {DURATIONS.map((d) => (
              <label key={d.value} className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="radio" name="dur" value={d.value} checked={dur === d.value} onChange={() => setDur(d.value)} className="accent-brand" />
                {d.label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {saved ? "Guardado" : "Guardar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
