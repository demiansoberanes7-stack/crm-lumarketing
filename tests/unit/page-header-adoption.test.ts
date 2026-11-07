import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La cabecera común, anclada a cada pantalla.
 *
 * El rediseño movió títulos y acciones a `PageHeader`; sin anclaje, un refactor
 * del JSX podía devolver una pantalla a su `<header>` propio sin que nada lo
 * notara. Las etiquetas de módulo son el contrato visible: cambian cuando la
 * pantalla cambia de sección, no por casualidad.
 */
const RAIZ = path.resolve(import.meta.dirname, "..", "..");

const PANTALLAS: Array<[string, string]> = [
  ["src/components/quotes/quotes-client.tsx", "Comercial · Cotizador"],
  ["src/components/tasks/tasks-client.tsx", "Trabajo · Tareas"],
  ["src/app/(app)/todo/todo-page-client.tsx", "Trabajo · Pendientes"],
  ["src/components/branches/branches-client.tsx", "Comercial · Sucursales"],
  ["src/components/prospects/prospects-client.tsx", "Comercial · Prospectos"],
  ["src/components/contacts/contacts-client.tsx", "Comercial · Clientes"],
  ["src/components/pipeline/pipeline-client.tsx", "Comercial · Pipeline"],
  ["src/components/projects/projects-client.tsx", "Trabajo · Proyectos"],
  ["src/components/catalog/catalog-client.tsx", "Comercial · Inventario"],
  ["src/components/finance/balance-client.tsx", "Finanzas · Balance"],
  ["src/components/suppliers/suppliers-client.tsx", "Operación · Proveedores"],
  ["src/components/broadcasts/broadcasts-client.tsx", "Campañas por correo"],
  ["src/components/inteligencia/intel-client.tsx", "Crecimiento · Inteligencia"],
  ["src/components/analytics/analytics-client.tsx", "Crecimiento · Analítica"],
  ["src/components/automations/automations-client.tsx", "Operación · Automatizaciones"],
  ["src/app/(app)/bookings/page.tsx", "Operación · Citas"],
  ["src/app/(app)/settings/layout.tsx", "Sistema · Configuración"],
];

describe("PageHeader en los módulos", () => {
  it.each(PANTALLAS)("%s conserva su cabecera común", (archivo, etiqueta) => {
    const fuente = readFileSync(path.join(RAIZ, archivo), "utf8");
    expect(fuente).toContain('from "@/components/page-header"');
    expect(fuente).toContain(`module="${etiqueta}"`);
  });
});
