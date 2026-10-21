"use client";

import { AlertCircle, RefreshCw } from "lucide-react";

/**
 * Estado de error para las listas del CRM.
 *
 * Existe porque varias pantallas hacían `fetch(...).catch(() => null)` y, si la
 * API respondía 500, caían en su propio estado vacío («Aún no hay…», «Sin
 * conversaciones todavía»). El dueño leía eso como «no tengo clientes» cuando lo
 * que pasó es que la lista no se pudo leer — en Prospectos pasó literalmente y
 * se perdió medio día buscando un chat que sí estaba en la bandeja.
 *
 * Regla de uso: este panel solo debe reemplazar al estado vacío, nunca a una
 * lista que ya se cargó. Si el refallo es de un refresco, lo correcto es dejar
 * los datos en pantalla.
 */
export function LoadError({
  message = "No se pudo cargar la lista.",
  detail,
  onRetry,
}: {
  message?: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertCircle className="h-8 w-8 text-destructive" strokeWidth={1.5} />
      <p className="text-sm font-medium">{message}</p>
      {detail ? (
        <p className="max-w-md text-xs text-muted-foreground">{detail}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <RefreshCw className="h-3 w-3" /> Reintentar
        </button>
      ) : null}
    </div>
  );
}
