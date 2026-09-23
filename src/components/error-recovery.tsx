"use client";

import { Button } from "@/components/ui/button";

export function ErrorRecovery({ reset }: { reset: () => void }) {
  return (
    <section role="alert" className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">No pudimos mostrar esta página</h1>
      <p className="max-w-md text-sm text-text-2">
        Ocurrió un error. Puedes volver a intentarlo o regresar al inicio.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Reintentar</Button>
        {/* Full navigation discards the failed router tree rather than reusing it. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="inline-flex items-center rounded-full border border-border-strong px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Volver al inicio</a>
      </div>
    </section>
  );
}
