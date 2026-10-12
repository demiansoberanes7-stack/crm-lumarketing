"use client";

import { useRef, useState } from "react";
import { Upload, FileText, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseCsv } from "@/lib/csv";

interface ImportResult {
  imported: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export function ImportContactsDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
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
      // Preview: primeras 5 filas (parseCsv respeta campos multilínea)
      const rows = parseCsv(text);
      setPreview(rows.slice(0, 5).map((r) => ({ raw: Object.values(r).join(", ") })));
    };
    reader.readAsText(file, "utf-8");
  }

  async function doImport() {
    if (!csvText) return;
    setImporting(true);
    setError("");
    try {
      const res = await fetch("/api/contacts/import", {
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
      if (data.imported > 0) onImported();
    } catch {
      setError("Error de conexión");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold">Importar contactos desde CSV</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Columnas requeridas: <strong>nombre</strong>, <strong>telefono</strong>. Opcionales: notas, fuente, etapa.
          Teléfono con código de país (ej. 5214621234567).
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
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
              <button
                type="button"
                onClick={() => { setFileName(""); setCsvText(""); setPreview([]); setResult(null); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Quitar
              </button>
            </div>

            {preview.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded-md border bg-muted/30 p-2">
                {preview.map((p, i) => (
                  <p key={i} className="truncate font-mono text-[10px] text-muted-foreground">{p.raw}</p>
                ))}
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            {result && (
              <div className="rounded-md border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>{result.imported} importados</span>
                </div>
                {result.skipped > 0 && (
                  <div className="mt-1 flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-yellow-500" />
                    <span>{result.skipped} omitidos</span>
                  </div>
                )}
                {result.errors.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {result.errors.slice(0, 5).map((e, i) => (
                      <li key={i}>Fila {e.row}: {e.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                {result ? "Cerrar" : "Cancelar"}
              </Button>
              {!result && (
                <Button onClick={() => void doImport()} disabled={importing || !csvText}>
                  {importing ? "Importando…" : `Importar${preview.length > 1 ? "" : ""}`}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
