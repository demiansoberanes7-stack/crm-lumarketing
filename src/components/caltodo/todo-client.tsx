"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, GripVertical, ChevronDown, ChevronUp, RotateCcw, Clock, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { format } from "date-fns";

type CalTodoTask = { id: string; title: string; details: string | null; urgent: boolean; duration: number | null; scheduledStart: Date | null; scheduledEnd: Date | null; completed: boolean; completedAt: Date | null; priority: number };
type CalTodoSettings = { workStartHour: number; workEndHour: number; timezone: string; defaultDuration: number } | null;

const DURATIONS = [
  { value: "15", label: "15 min" }, { value: "30", label: "30 min" }, { value: "45", label: "45 min" },
  { value: "60", label: "1 hora" }, { value: "90", label: "1.5 horas" }, { value: "120", label: "2 horas" },
  { value: "180", label: "3 horas" }, { value: "240", label: "4 horas" },
];

export function TodoClient({ initialTasks, initialSettings }: { initialTasks: CalTodoTask[]; initialSettings: CalTodoSettings }) {
  const [tasks, setTasks] = useState<CalTodoTask[]>(initialTasks);
  const [_settings] = useState<CalTodoSettings>(initialSettings);
  const [newTitle, setNewTitle] = useState("");
  const [newDetails, setNewDetails] = useState("");
  const [newUrgent, setNewUrgent] = useState(false);
  const [newDuration, setNewDuration] = useState("default");
  const [completedOpen, setCompletedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/caltodo/tasks");
    if (res.ok) { const d = await res.json() as { tasks: CalTodoTask[]; settings: CalTodoSettings }; setTasks(d.tasks); }
  }, []);

  const incomplete = tasks.filter((t) => !t.completed).sort((a, b) => a.priority - b.priority);
  const completed = tasks.filter((t) => t.completed).sort((a, b) => {
    const da = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const db = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return db - da;
  });

  async function createTask() {
    if (!newTitle.trim()) return;
    setBusy(true);
    const res = await fetch("/api/caltodo/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: newTitle, details: newDetails || undefined, urgent: newUrgent, duration: newDuration !== "default" ? Number(newDuration) : undefined }) });
    if (res.ok) { setNewTitle(""); setNewDetails(""); setNewUrgent(false); setNewDuration("default"); await refresh(); }
    setBusy(false);
  }

  async function toggleComplete(id: string, completed: boolean) {
    setBusy(true);
    await fetch(`/api/caltodo/tasks?id=${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ completed }) });
    await refresh();
    setBusy(false);
  }

  async function handleDragEnd(result: DropResult) {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;
    const moved = incomplete[result.source.index]!;
    const reordered = [...incomplete];
    reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    const ids = reordered.map((t) => t.id);
    setTasks((prev) => {
      const updated = [...prev];
      ids.forEach((id, i) => { const idx = updated.findIndex((t) => t.id === id); if (idx >= 0) updated[idx] = { ...updated[idx]!, priority: i }; });
      return updated;
    });
    await fetch("/api/caltodo/tasks/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskIds: ids }) });
  }

  async function rescheduleAll() {
    setBusy(true);
    await fetch("/api/caltodo/tasks/reschedule", { method: "POST" });
    await refresh();
    setBusy(false);
  }

  return (
    <div className="max-w-4xl space-y-5">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold flex items-center gap-2"><Plus className="h-5 w-5" /> Crear tarea</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); void createTask(); }} className="space-y-3">
            <Input ref={titleRef} placeholder="¿Qué hay que hacer?" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="text-base" />
            <Textarea placeholder="Detalles (opcional)" value={newDetails} onChange={(e) => setNewDetails(e.target.value)} rows={3} />
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={newUrgent} onChange={(e) => setNewUrgent(e.target.checked)} className="h-4 w-4 accent-destructive" />
                  <AlertTriangle className="h-4 w-4 text-destructive" /> Urgente
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-2">Duración:</span>
                  <select value={newDuration} onChange={(e) => setNewDuration(e.target.value)} className="rounded border bg-background p-1.5 text-sm">
                    <option value="default">Por defecto</option>
                    {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
              </div>
              <Button type="submit" disabled={!newTitle.trim() || busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Crear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-lg font-semibold">Tareas</h2>
          {incomplete.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => void rescheduleAll()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Reprogramar todo
            </Button>
          )}
        </div>
        {incomplete.length === 0 ? (
          <Card><CardContent className="p-8 text-center"><p className="text-text-2">Sin tareas. Crea una arriba.</p></CardContent></Card>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="tasks" isDropDisabled={busy}>
              {(provided) => (
                <div {...provided.droppableProps} ref={provided.innerRef} className={`space-y-2 transition-opacity ${busy ? "opacity-50 pointer-events-none" : ""}`}>
                  {incomplete.map((task, index) => (
                    <Draggable key={task.id} draggableId={task.id} index={index} isDragDisabled={busy}>
                      {(provided, snapshot) => (
                        <div ref={provided.innerRef} {...provided.draggableProps} className={`rounded-lg border border-border-strong bg-card shadow-sm transition-shadow ${snapshot.isDragging ? "shadow-lg ring-2 ring-brand/20" : ""}`}>
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <div {...provided.dragHandleProps} className="mt-0.5 cursor-grab active:cursor-grabbing text-text-3"><GripVertical className="h-5 w-5" /></div>
                              <input type="checkbox" checked={false} onChange={() => void toggleComplete(task.id, true)} className="mt-1 h-4 w-4 accent-brand" />
                              <div className="flex-1 min-w-0">
                                <span className="font-medium">{task.title}</span>
                                {task.details && <p className="text-sm text-text-2 mt-1 line-clamp-2">{task.details}</p>}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {task.urgent && <Badge variant="destructive" className="text-xs">Urgente</Badge>}
                                {task.duration && <Badge variant="outline" className="gap-1 text-xs">{task.duration >= 60 ? `${task.duration / 60}h` : `${task.duration}m`}</Badge>}
                                {task.scheduledStart && <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />{format(new Date(task.scheduledStart), "EEE dd.MM HH:mm")}</Badge>}
                              </div>
                            </div>
                          </CardContent>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </div>

      {completed.length > 0 && (
        <div>
          <button onClick={() => setCompletedOpen(!completedOpen)} className="flex items-center gap-2 w-full px-4 py-2 text-sm font-medium text-text-2 hover:bg-accent rounded-md transition-colors">
            <span>Completadas</span>
            <Badge variant="secondary" className="text-xs">{completed.length}</Badge>
            <span className="flex-1" />
            {completedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {completedOpen && (
            <div className="space-y-2 mt-2">
              {completed.map((task) => (
                <Card key={task.id} className="opacity-70">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked readOnly className="mt-1 h-4 w-4" />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-text-2">{task.title}</span>
                        {task.completedAt && <p className="text-xs text-text-3 mt-1">Completada {format(new Date(task.completedAt), "EEE dd.MM HH:mm")}</p>}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => void toggleComplete(task.id, false)}>
                        <RotateCcw className="h-4 w-4 mr-1" /> Rehacer
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
