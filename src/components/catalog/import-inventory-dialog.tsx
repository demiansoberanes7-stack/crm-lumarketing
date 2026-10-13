"use client";

import { useRef, useState } from "react";
import { Upload, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseCsv } from "@/lib/csv";

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

/**
 * Importa productos del inventario desde un CSV/hoja de cálculo.
 * El archivo .xlsx de Excel se exporta primero a CSV (o se pega desde
 * Excel con las columnas correctas). Match por nombre → actualiza o crea.
 */
export function ImportInventoryDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  function handleFile(file: File) {
    setError("");
    setResult(null);
    if (file.size > 2_000_000) {
      setError("El archivo no puede superar 2 MB");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      const rows = parseCsv(text);
      setPreview(rows.slice(0, 5).map((r) => Object.values(r).join(" · ")));
    };
    reader.readAsText(file, "utf-8");
  }

  async function doImport() {
    if (!csvText) return;
    setImporting(true);
    setError("");
    try {
      const res = await fetch("/api/catalog/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: csvText }),
      });
      const data = (await res.json()) as ImportResult & { error?: { message: string } };
      if (!res.ok) {
        setError(data.error?.message ?? "Error al importar");
        return;
      }
      setResult(data);
      if (data.created + data.updated > 0) onImported();
    } catch {
      setError("Error de conexión");
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setFileName("");
    setCsvText("");
    setPreview([]);
    setResult(null);
    setError("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-semibold">Importar inventario</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Columnas: <strong>nombre</strong>, <strong>precio_mxn</strong> (requeridas);
          descripcion_corta, url_sitio, inventario (opcionales). Si el nombre ya existe se
          actualiza; si no, se crea. Usa un CSV exportado desde Excel.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />

        {!csvText ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-muted-foreground hover:border-primary/50 hover:text-foreground"
          >
            <Upload className="h-8 w-8" />
            <span className="text-sm font-medium">Seleccionar archivo CSV</span>
            <span className="text-xs">o arrástralo aquí</span>
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border px-3 py-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 truncate text-sm">{fileName}</span>
              <button type="button" onClick={reset} className="text-xs text-muted-foreground hover:text-foreground">
                Quitar
              </button>
            </div>

            {preview.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded-md border bg-muted/30 p-2">
                {preview.map((line, i) => (
                  <p key={i} className="truncate font-mono text-[11px] text-text-2">{line}</p>
                ))}
              </div>
            )}

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            {result && (
              <div className="rounded-md border bg-subtle p-3 text-sm">
                <p>
                  <strong>{result.created}</strong> creados · <strong>{result.updated}</strong> actualizados ·{" "}
                  <strong>{result.skipped}</strong> omitidos
                </p>
                {result.errors.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-destructive">
                    {result.errors.slice(0, 8).map((e, i) => (
                      <li key={i}>Fila {e.row}: {e.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cerrar</Button>
              <Button disabled={importing || !csvText} onClick={() => void doImport()}>
                {importing ? "Importando…" : "Importar"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
