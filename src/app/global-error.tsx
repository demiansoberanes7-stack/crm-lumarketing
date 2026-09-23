"use client";

// Replaces the root layout: must work without fonts, theme, auth or database.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, background: "#fff", color: "#171717", fontFamily: "system-ui, sans-serif" }}>
        <main role="alert" style={{ maxWidth: 560, margin: "15vh auto", padding: 24 }}>
          <h1>No pudimos cargar el CRM</h1>
          <p>Ocurrió un error al iniciar la página. Vuelve a intentarlo.</p>
          <button onClick={reset} style={{ padding: "12px 20px", marginRight: 20 }}>Reintentar</button>
          {/* Hard navigation must work even when the root/router tree has failed. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/">Volver al inicio</a>
        </main>
      </body>
    </html>
  );
}
