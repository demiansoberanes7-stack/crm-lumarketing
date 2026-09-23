"use client";
import { useState, useRef, useEffect } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, GripVertical, ChevronDown, ChevronUp, RotateCcw, Clock, AlertTriangle, Loader2, RefreshCw, Pencil, Trash2, User, FolderKanban } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { zonedDisplayDate, type CalTodoItem, type CalTodoPreferences } from "@/lib/caltodo";
import { todoRequest } from "./request";
import type { ContactDto } from "@/lib/types";

type CalTodoTask = CalTodoItem;
type CalTodoSettings = CalTodoPreferences | null;

type ProjectDto = { id: string; name: string; code: string };

const DURATIONS = [
  { value: "15", label: "15 min" }, { value: "30", label: "30 min" }, { value: "45", label: "45 min" },
  { value: "60", label: "1 hora" }, { value: "90", label: "1.5 horas" }, { value: "120", label: "2 horas" },
  { value: "180", label: "3 horas" }, { value: "240", label: "4 horas" },
];

export function TodoClient({ tasks, settings, onTasksChange, refresh }: { tasks: CalTodoTask[]; settings: CalTodoSettings; onTasksChange: (tasks: CalTodoTask[]) => void; refresh: () => Promise<void> }) {
  const [newTitle, setNewTitle] = useState("");
  const [newDetails, setNewDetails] = useState("");
  const [newUrgent, setNewUrgent] = useState(false);
  const [newDuration, setNewDuration] = useState("default");
  const [newContactId, setNewContactId] = useState<string | null>(null);
  const [newProjectId, setNewProjectId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  useEffect(() => {
    fetch("/api/contacts")
      .then((res) => res.json())
      .then((data: { contacts: ContactDto[] }) => setContacts(data.contacts))
      .catch(() => {});
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data: { projects?: ProjectDto[] } | ProjectDto[]) => setProjects(Array.isArray(data) ? data : data.projects ?? []))
      .catch(() => {});
  }, []);

  const timezone = settings?.timezone ?? "America/Mexico_City";
  const dateLabel = (date: Date | string) => format(zonedDisplayDate(date, timezone), "EEE dd.MM HH:mm", { locale: es });
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo completar la operación"); }
    finally { setBusy(false); }
  }
  function resetForm() { setEditingId(null); setNewTitle(""); setNewDetails(""); setNewUrgent(false); setNewDuration("default"); setNewContactId(null); setNewProjectId(null); }

  const incomplete = tasks.filter((t) => !t.completed).sort((a, b) => a.priority - b.priority);
  const completed = tasks.filter((t) => t.completed).sort((a, b) => {
    const da = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const db = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return db - da;
  });

  async function createTask() {
    if (!newTitle.trim()) return;
    await run(async () => {
      await todoRequest(editingId ? `/api/caltodo/tasks?id=${editingId}` : "/api/caltodo/tasks", { method: editingId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: newTitle, details: newDetails, urgent: newUrgent, duration: newDuration !== "default" ? Number(newDuration) : settings?.defaultDuration ?? 60, contactId: newContactId, projectId: newProjectId }) });
      resetForm(); await refresh();
    });
  }

  async function toggleComplete(id: string, completed: boolean) {
    await run(async () => {
      await todoRequest(`/api/caltodo/tasks?id=${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ completed }) });
      await refresh();
    });
  }

  async function removeTask(task: CalTodoTask) {
    if (!confirm(`¿Eliminar la tarea «${task.title}»?`)) return;
    await run(async () => { await todoRequest(`/api/caltodo/tasks?id=${task.id}`, { method: "DELETE" }); if (editingId === task.id) resetForm(); await refresh(); });
  }

  async function handleDragEnd(result: DropResult) {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;
    const moved = incomplete[result.source.index]!;
    const reordered = [...incomplete];
    reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    const ids = reordered.map((t) => t.id);
    const previous = tasks;
    onTasksChange(tasks.map((t) => ids.includes(t.id) ? { ...t, priority: ids.indexOf(t.id) } : t));
    await run(async () => {
      try {
        await todoRequest("/api/caltodo/tasks/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskIds: ids }) });
        await refresh();
      } catch (err) { onTasksChange(previous); throw err; }
    });
  }

  async function rescheduleAll() {
    await run(async () => { await todoRequest("/api/caltodo/tasks/reschedule", { method: "POST" }); await refresh(); });
  }

  return (
    <div className="max-w-4xl space-y-5">
      {error && <p role="alert" className="rounded border border-destructive p-3 text-sm text-destructive">{error}</p>}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold flex items-center gap-2"><Plus className="h-5 w-5" /> {editingId ? "Editar tarea" : "Crear tarea"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); void createTask(); }} className="space-y-3">
            <Input aria-label="Título de la tarea" required maxLength={200} ref={titleRef} placeholder="¿Qué hay que hacer?" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="text-base" />
            <Textarea aria-label="Detalles de la tarea" maxLength={5000} placeholder="Detalles (opcional)" value={newDetails} onChange={(e) => setNewDetails(e.target.value)} rows={3} />
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={newUrgent} onChange={(e) => setNewUrgent(e.target.checked)} className="h-4 w-4 accent-destructive" />
                  <AlertTriangle className="h-4 w-4 text-destructive" /> Urgente
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-2">Duración:</span>
                   <select aria-label="Duración de la tarea" value={newDuration} onChange={(e) => setNewDuration(e.target.value)} className="rounded border bg-background p-1.5 text-sm">
                     <option value="default">Por defecto ({settings?.defaultDuration ?? 60} min)</option>
                    {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-text-2" />
                  <select aria-label="Contacto asociado" value={newContactId ?? ""} onChange={(e) => setNewContactId(e.target.value || null)} className="rounded border bg-background p-1.5 text-sm">
                    <option value="">Sin contacto</option>
                    {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <FolderKanban className="h-4 w-4 text-text-2" />
                  <select aria-label="Proyecto asociado" value={newProjectId ?? ""} onChange={(e) => setNewProjectId(e.target.value || null)} className="rounded border bg-background p-1.5 text-sm">
                    <option value="">Sin proyecto</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </select>
                </div>
              </div>
              <Button type="submit" disabled={!newTitle.trim() || busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                 {editingId ? "Guardar tarea" : "Crear"}
               </Button>
               {editingId && <Button variant="ghost" type="button" onClick={resetForm}>Cancelar edición</Button>}
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
                            <div className="flex flex-wrap items-start gap-3">
                              <div {...provided.dragHandleProps} aria-label={`Reordenar ${task.title}`} className="mt-0.5 cursor-grab active:cursor-grabbing text-text-3"><GripVertical className="h-5 w-5" /></div>
                              <input aria-label={`Completar ${task.title}`} type="checkbox" checked={false} onChange={() => void toggleComplete(task.id, true)} className="mt-1 h-4 w-4 accent-brand" />
                              <div className="flex-1 min-w-0">
                                <span className="break-words font-medium">{task.title}</span>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  {task.contactId && (
                                    <Badge variant="outline" className="text-xs">
                                      <User className="h-3 w-3 mr-1" />
                                      {contacts.find((c) => c.id === task.contactId)?.name ?? "Contacto"}
                                    </Badge>
                                  )}
                                  {task.projectId && (
                                    <Badge variant="outline" className="text-xs">
                                      <FolderKanban className="h-3 w-3 mr-1" />
                                      {projects.find((p) => p.id === task.projectId)?.name ?? "Proyecto"}
                                    </Badge>
                                  )}
                                </div>
                                {task.details && <p className="text-sm text-text-2 mt-1 line-clamp-2">{task.details}</p>}
                              </div>
                              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                                {task.urgent && <Badge variant="destructive" className="text-xs">Urgente</Badge>}
                                {task.duration && <Badge variant="outline" className="gap-1 text-xs">{task.duration >= 60 ? `${task.duration / 60}h` : `${task.duration}m`}</Badge>}
                                {task.scheduledStart && <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />{dateLabel(task.scheduledStart)}</Badge>}
                                <Button variant="ghost" size="icon" aria-label={`Editar ${task.title}`} disabled={busy} onClick={() => { setEditingId(task.id); setNewTitle(task.title); setNewDetails(task.details ?? ""); setNewUrgent(task.urgent); setNewDuration(task.duration ? String(task.duration) : "default"); setNewContactId(task.contactId); setNewProjectId(task.projectId); titleRef.current?.focus(); }}><Pencil className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" aria-label={`Eliminar ${task.title}`} disabled={busy} onClick={() => void removeTask(task)}><Trash2 className="h-4 w-4" /></Button>
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
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {task.contactId && (
                            <Badge variant="outline" className="text-xs">
                              <User className="h-3 w-3 mr-1" />
                              {contacts.find((c) => c.id === task.contactId)?.name ?? "Contacto"}
                            </Badge>
                          )}
                          {task.projectId && (
                            <Badge variant="outline" className="text-xs">
                              <FolderKanban className="h-3 w-3 mr-1" />
                              {projects.find((p) => p.id === task.projectId)?.name ?? "Proyecto"}
                            </Badge>
                          )}
                        </div>
                        {task.completedAt && <p className="text-xs text-text-3 mt-1">Completada {dateLabel(task.completedAt)}</p>}
                      </div>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void toggleComplete(task.id, false)}>
                        <RotateCcw className="h-4 w-4 mr-1" /> Rehacer
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Eliminar ${task.title}`} disabled={busy} onClick={() => void removeTask(task)}><Trash2 className="h-4 w-4" /></Button>
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
