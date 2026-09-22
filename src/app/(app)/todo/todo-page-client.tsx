"use client";
import { useState, useCallback } from "react";
import { TodoClient } from "@/components/caltodo/todo-client";
import { CalendarView } from "@/components/caltodo/calendar-view";
import { TodoSettings } from "@/components/caltodo/todo-settings";
import { List, CalendarDays, Settings } from "lucide-react";
import type { CalTodoItem, CalTodoPreferences } from "@/lib/caltodo";
import { todoRequest } from "@/components/caltodo/request";

type Task = CalTodoItem;
type SettingsData = CalTodoPreferences | null;

const TABS = [
  { key: "list", label: "Lista", icon: List },
  { key: "calendar", label: "Calendario", icon: CalendarDays },
  { key: "settings", label: "Configuración", icon: Settings },
] as const;

export function TodoPageClient({ initialTasks, initialSettings }: { initialTasks: Task[]; initialSettings: SettingsData }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [settings, setSettings] = useState(initialSettings);
  const [tab, setTab] = useState<"list" | "calendar" | "settings">("list");

  const refresh = useCallback(async () => {
    const data = await todoRequest<{ tasks: Task[]; settings: SettingsData }>("/api/caltodo/tasks");
    setTasks(data.tasks);
    setSettings(data.settings);
  }, []);

  async function saveSettings(data: Record<string, unknown>) {
    await todoRequest("/api/caltodo/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    await refresh();
  }

  return (
    <div className="min-w-0 space-y-5 p-4 sm:p-6">
      <header><h1 className="text-2xl font-bold tracking-tight">Pendientes</h1>
      <p className="mt-1 text-sm text-text-2">Organiza tus tareas personales y planifica tu jornada.</p></header>
      <div role="tablist" aria-label="Vistas del calendario" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <button role="tab" aria-selected={tab === t.key} aria-controls="todo-panel" key={t.key} onClick={() => setTab(t.key)} className={`flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-b-2 ${tab === t.key ? "border-brand text-brand" : "border-transparent text-text-2 hover:text-foreground"}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>
      <div id="todo-panel" role="tabpanel" aria-label={TABS.find((t) => t.key === tab)?.label}>
      {tab === "list" && <TodoClient tasks={tasks} settings={settings} onTasksChange={setTasks} refresh={refresh} />}
      {tab === "calendar" && <CalendarView tasks={tasks} settings={settings} />}
      {tab === "settings" && <TodoSettings initial={settings} onSave={saveSettings} />}
      </div>
    </div>
  );
}
