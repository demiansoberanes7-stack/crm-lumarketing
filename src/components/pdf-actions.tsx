"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
export function PdfActions({ url, filename }: { url: string; filename: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <div className="flex flex-wrap items-center gap-2">
    <a className="rounded border px-3 py-2 text-sm" href={url} target="_blank" rel="noreferrer" aria-label="Ver PDF en nueva pestaña">Ver PDF</a>
    <Button variant="outline" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const res = await fetch(url);
        if (!res.ok || !res.headers.get("content-type")?.includes("application/pdf")) throw new Error("No se pudo descargar el PDF");
        const href = URL.createObjectURL(await res.blob());
        const link = document.createElement("a"); link.href = href; link.download = filename; link.click();
        setTimeout(() => URL.revokeObjectURL(href), 300000);
      } catch (e) { setError(e instanceof Error ? e.message : "Error al descargar"); }
      finally { setBusy(false); }
    }}>{busy ? "Preparando…" : "Descargar PDF"}</Button>
    {error && <span role="alert" className="text-destructive">{error}</span>}
  </div>;
}
