"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Database,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TABLES = [
  { key: "messages", label: "Mensajes", count: 0 },
  { key: "conversations", label: "Conversaciones", count: 0 },
  { key: "leads", label: "Leads", count: 0 },
  { key: "leadStageEvents", label: "Historial de Etapas", count: 0 },
  { key: "projects", label: "Proyectos", count: 0 },
  { key: "projectStageEvents", label: "Historial de Proyectos", count: 0 },
  { key: "projectTasks", label: "Tareas de Proyecto", count: 0 },
  { key: "quotes", label: "Cotizaciones", count: 0 },
  { key: "quoteEvents", label: "Historial de Cotizaciones", count: 0 },
  { key: "charges", label: "Cargos", count: 0 },
  { key: "payments", label: "Pagos", count: 0 },
  { key: "expenses", label: "Gastos", count: 0 },
  { key: "bookings", label: "Citas", count: 0 },
  { key: "offeredSlots", label: "Horarios Ofrecidos", count: 0 },
  { key: "caltodoTasks", label: "Tareas", count: 0 },
  { key: "outboundDeliveries", label: "Entregas Salientes", count: 0 },
  { key: "mediaAssets", label: "Archivos Multimedia", count: 0 },
  { key: "agentTestRuns", label: "Pruebas de Agente", count: 0 },
  { key: "agentTestCases", label: "Casos de Prueba", count: 0 },
  { key: "emailMessages", label: "Mensajes de Email", count: 0 },
];

export function DataCleanupClient() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set(TABLES.map((t) => t.key)));
  const [preview, setPreview] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const toggleTable = (key: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelectedTables(new Set(TABLES.map((t) => t.key)));
  const deselectAll = () => setSelectedTables(new Set());

  const handlePreview = async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/data-cleanup/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          tables: Array.from(selectedTables),
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { counts: Record<string, number> };
        setPreview(data.counts);
      }
    } catch { /* empty */ }
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!startDate || !endDate || !preview) return;
    if (!confirm("¿Eliminar los datos seleccionados? Esta accion no se puede deshacer.")) return;
    setDeleting(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/data-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          tables: Array.from(selectedTables),
        }),
      });
      const data = await res.json();
      setResult({ ok: res.ok, message: data.message || (res.ok ? "Datos eliminados" : "Error al eliminar") });
      if (res.ok) setPreview(null);
    } catch {
      setResult({ ok: false, message: "Error de conexion" });
    }
    setDeleting(false);
  };

  const totalRecords = preview ? Object.values(preview).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Limpieza de Datos</h2>
        <p className="text-sm text-muted-foreground">
          Elimina datos historicos por rango de fecha para mantener la base de datos optimizada.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4" />
            Rango de Fechas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Desde</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Hasta</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const now = new Date();
                const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
                setStartDate(firstDay.toISOString().split("T")[0]!);
                setEndDate(now.toISOString().split("T")[0]!);
              }}
            >
              Este mes
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const now = new Date();
                const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
                setStartDate(lastMonth.toISOString().split("T")[0]!);
                setEndDate(lastDay.toISOString().split("T")[0]!);
              }}
            >
              Mes anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const now = new Date();
                const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
                setStartDate(threeMonthsAgo.toISOString().split("T")[0]!);
                setEndDate(now.toISOString().split("T")[0]!);
              }}
            >
              Ultimos 3 meses
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Tablas a Limpiar
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={selectAll}>Todas</Button>
              <Button variant="outline" size="sm" onClick={deselectAll}>Ninguna</Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {TABLES.map((t) => (
              <label
                key={t.key}
                className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={selectedTables.has(t.key)}
                  onChange={() => toggleTable(t.key)}
                  className="h-3.5 w-3.5 rounded"
                />
                <span className="flex-1 truncate">{t.label}</span>
                {preview && preview[t.key] !== undefined && (
                  <Badge variant="outline" className="text-[10px]">
                    {preview[t.key]}
                  </Badge>
                )}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button
          onClick={handlePreview}
          disabled={loading || !startDate || !endDate || selectedTables.size === 0}
        >
          {loading ? "Consultando..." : "Vista Previa"}
        </Button>
        {preview && (
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting || totalRecords === 0}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            {deleting ? "Eliminando..." : `Eliminar ${totalRecords.toLocaleString()} registro${totalRecords !== 1 ? "s" : ""}`}
          </Button>
        )}
      </div>

      {preview && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Resultado de la Vista Previa</CardTitle>
          </CardHeader>
          <CardContent>
            {totalRecords === 0 ? (
              <p className="text-sm text-muted-foreground">
                No se encontraron registros en el rango seleccionado.
              </p>
            ) : (
              <div className="space-y-2">
                {Object.entries(preview)
                  .filter(([, count]) => count > 0)
                  .map(([key, count]) => {
                    const table = TABLES.find((t) => t.key === key);
                    return (
                      <div key={key} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <span className="text-sm">{table?.label || key}</span>
                        <Badge variant="destructive">{count.toLocaleString()}</Badge>
                      </div>
                    );
                  })}
                <div className="flex items-center justify-between rounded-md border border-primary bg-primary/5 px-3 py-2 font-medium">
                  <span className="text-sm">Total</span>
                  <Badge>{totalRecords.toLocaleString()}</Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {result && (
        <div className={`flex items-center gap-2 rounded-md border p-3 text-sm ${
          result.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"
        }`}>
          {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {result.message}
        </div>
      )}
    </div>
  );
}
