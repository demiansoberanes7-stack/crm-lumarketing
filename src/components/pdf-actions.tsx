"use client";
import { useState } from "react";
import { Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PdfPreview } from "./pdf-preview";

/**
 * Controles de PDF compartidos (cotizaciones, proyectos, balance):
 * "Ver PDF" abre la vista previa dentro de la app y "Descargar PDF" baja el
 * archivo con el nombre indicado. `compact` deja botones icono para listas.
 */
export function PdfActions({
  url,
  filename,
  compact = false,
}: {
  url: string;
  filename: string;
  compact?: boolean;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  async function descargar() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url);
      if (!res.ok || !res.headers.get("content-type")?.includes("application/pdf")) {
        throw new Error("No se pudo descargar el PDF");
      }
      const href = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 300000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al descargar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {compact ? (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            aria-label={`Ver PDF de ${filename}`}
            title="Ver PDF"
            onClick={() => setPreview(true)}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            aria-label={`Descargar PDF de ${filename}`}
            title="Descargar PDF"
            disabled={busy}
            onClick={() => void descargar()}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Button variant="outline" onClick={() => setPreview(true)}>
            Ver PDF
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void descargar()}>
            {busy ? "Preparando…" : "Descargar PDF"}
          </Button>
          {error && (
            <span role="alert" className="text-destructive">
              {error}
            </span>
          )}
        </div>
      )}
      {preview && <PdfPreview url={url} filename={filename} onClose={() => setPreview(false)} />}
    </>
  );
}
