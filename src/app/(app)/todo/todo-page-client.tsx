"use client";
import { useState, useCallback } from "react";
import { TodoClient } from "@/components/caltodo/todo-client";
import { CalendarView } from "@/components/caltodo/calendar-view";
import { TodoSettings } from "@/components/caltodo/todo-settings";
import { List, CalendarDays, Settings } from "lucide-react";

type Task = { id: string; title: string; details: string | null; urgent: boolean; duration: number | null; scheduledStart: Date | null; scheduledEnd: Date | null; completed: boolean; completedAt: Date | null; priority: number };
type SettingsData = { workStartHour: number; workEndHour: number; timezone: string; defaultDuration: number } | null;

const TABS = [
  { key: "list", label: "Lista", icon: List },
  { key: "calendar", label: "Calendario", icon: CalendarDays },
  { key: "settings", label: "Config", icon: Settings },
] as const;

export function TodoPageClient({ initialTasks, initialSettings }: { initialTasks: Task[]; initialSettings: SettingsData }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [settings, setSettings] = useState(initialSettings);
  const [tab, setTab] = useState<"list" | "calendar" | "settings">("list");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/caltodo/tasks");
    if (res.ok) { const d = await res.json() as { tasks: Task[]; settings: SettingsData }; setTasks(d.tasks); setSettings(d.settings); }
  }, []);

  async function saveSettings(data: Record<string, unknown>) {
    await fetch("/api/caltodo/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    await refresh();
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Mis Tareas</h1>
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 ${tab === t.key ? "border-brand text-brand" : "border-transparent text-text-2 hover:text-foreground"}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === "list" && <TodoClient initialTasks={tasks} initialSettings={settings} />}
      {tab === "calendar" && <CalendarView tasks={tasks} settings={settings} />}
      {tab === "settings" && <TodoSettings initial={settings} onSave={saveSettings} />}
    </div>
  );
}
