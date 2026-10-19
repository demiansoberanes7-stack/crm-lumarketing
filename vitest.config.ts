import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Un componente de servidor (src/app/layout.tsx) se renderiza en prueba; con
  // el runtime clásico de esbuild emite `React.createElement` y React no está
  // importado en ese módulo.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
