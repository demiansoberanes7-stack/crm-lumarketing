"use client";
import { useEffect, useState } from "react";
import { Download, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Vista previa del PDF dentro de la app. El archivo se baja como blob y se
 * sirve al iframe por objectURL, así que funciona aunque la ruta responda con
 * `Content-Disposition: attachment` (igual que en las cotizaciones).
 */
export function PdfPreview({
  url,
  filename,
  onClose,
}: {
  url: string;
  filename: string;
  onClose: () => void;
}) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok || !res.headers.get("content-type")?.includes("application/pdf")) {
          throw new Error("No se pudo cargar el PDF");
        }
        objectUrl = URL.createObjectURL(await res.blob());
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setSrc(objectUrl);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo cargar el PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const downloadUrl = `${url}${url.includes("?") ? "&" : "?"}download=1`;

  return (
    // stopPropagation: el modal puede vivir dentro de una fila/clickable y los
    // clics sobre él no deben navegar ni seleccionar el elemento de atrás.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Vista previa de ${filename}`}
        className="flex h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:px-4">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{filename}</span>
          <a
            className="rounded border px-3 py-1.5 text-sm hover:bg-accent"
            href={downloadUrl}
            download={filename}
          >
            <Download className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
            Descargar
          </a>
          <a
            className="rounded border px-3 py-1.5 text-sm hover:bg-accent"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
            Pestaña nueva
          </a>
          <Button variant="ghost" size="icon" aria-label="Cerrar vista previa" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 bg-muted">
          {error ? (
            <p role="alert" className="p-6 text-sm text-destructive">
              {error}
            </p>
          ) : loading ? (
            <p role="status" className="p-6 text-sm text-muted-foreground">
              Cargando PDF…
            </p>
          ) : (
            <iframe
              src={src}
              title={`Vista previa de ${filename}`}
              className="h-full w-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
