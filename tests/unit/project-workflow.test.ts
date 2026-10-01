import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GENERAL_STEP,
  PROJECT_STATUSES,
  PROJECT_STATUS_BADGE,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPES,
  PROJECT_TYPE_KEYS,
  findStep,
  formatFieldValue,
  getProjectType,
  isProjectTypeKey,
  parseStepData,
  stepDataDefaults,
  statusToEstado,
  stepsForType,
  type ProjectFieldDef,
  type ProjectStepDef,
} from "@/lib/project-types";

/**
 * Tests del módulo de proyectos: registro de tipos (modularidad),
 * validación derivada de los campos, estados de workflow y migración 0020.
 */

const ROOT = process.cwd();
const DRIZZLE_DIR = path.join(ROOT, "drizzle");
const SQL_0020 = readFileSync(path.join(DRIZZLE_DIR, "0020_project_workflow.sql"), "utf8");
const JOURNAL = JSON.parse(
  readFileSync(path.join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8")
) as { entries: { idx: number; tag: string }[] };

describe("registro de tipos de proyecto", () => {
  it("incluye los 3 tipos base con claves únicas", () => {
    expect(PROJECT_TYPES.map((t) => t.key)).toEqual([
      "marketing",
      "maintenance",
      "web_service",
    ]);
    expect(new Set(PROJECT_TYPE_KEYS).size).toBe(PROJECT_TYPE_KEYS.length);
    expect(PROJECT_TYPES.every((t) => t.label && t.description)).toBe(true);
  });

  it("cada tipo define al menos 4 pasos con campos", () => {
    for (const type of PROJECT_TYPES) {
      expect(type.steps.length).toBeGreaterThanOrEqual(4);
      for (const step of type.steps) {
        expect(step.kind).toBe("data");
        expect(step.fields.length).toBeGreaterThan(0);
        const keys = step.fields.map((f) => f.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const field of step.fields) {
          expect(field.key).toMatch(/^[a-z0-9_]+$/);
          expect(field.label.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("los tipos nuevos se agregan sin tocar componentes (shape completo)", () => {
    const fakeType = {
      key: "diseno_grafico",
      label: "Diseño gráfico",
      description: "Identidad y piezas visuales.",
      steps: [
        {
          key: "brief",
          label: "Brief",
          kind: "data" as const,
          fields: [
            { key: "marca", label: "Marca", type: "text" as const, required: true },
            {
              key: "formatos",
              label: "Formatos",
              type: "multiselect" as const,
              required: true,
              options: [
                { value: "logo", label: "Logo" },
                { value: "banner", label: "Banner" },
              ],
            },
          ],
        },
      ],
    };
    PROJECT_TYPES.push(fakeType);
    try {
      expect(stepsForType("diseno_grafico").map((s) => s.key)).toEqual([
        "general",
        "brief",
      ]);
      expect(isProjectTypeKey("diseno_grafico")).toBe(true);
      const ok = parseStepData(fakeType.steps[0]!, {
        marca: "LUMARK",
        formatos: ["logo"],
      });
      expect(ok.ok).toBe(true);
      const bad = parseStepData(fakeType.steps[0]!, { marca: "LUMARK", formatos: [] });
      expect(bad.ok).toBe(false);
    } finally {
      PROJECT_TYPES.pop();
    }
    expect(isProjectTypeKey("diseno_grafico")).toBe(false);
  });

  it("stepsForType siempre encabeza con el paso general", () => {
    for (const type of PROJECT_TYPES) {
      const steps = stepsForType(type.key);
      expect(steps[0]).toEqual(GENERAL_STEP);
      expect(steps.length).toBe(type.steps.length + 1);
    }
    expect(findStep("marketing", "objetivos")?.label).toBe("Objetivos");
    expect(findStep("marketing", "inventario")).toBeUndefined();
    expect(getProjectType("no_existe")).toBeUndefined();
    expect(isProjectTypeKey("no_existe")).toBe(false);
  });
});

describe("paso general (columnas del proyecto)", () => {
  it("declara los campos del expediente: nombre, cliente, responsable y fechas", () => {
    expect(GENERAL_STEP.kind).toBe("project");
    const keys = GENERAL_STEP.fields.map((f) => f.key);
    expect(keys).toEqual(["name", "contactId", "assignedUserId", "startDate", "endDate", "notas"]);
    expect(GENERAL_STEP.fields.find((f) => f.key === "name")?.required).toBe(true);
  });

  it("valida nombre obligatorio y acepta un proyecto completo", () => {
    const bad = parseStepData(GENERAL_STEP, { name: "" });
    expect(bad.ok).toBe(false);
    const ok = parseStepData(GENERAL_STEP, {
      name: "Campaña 2026",
      contactId: "ct_1",
      assignedUserId: "usr_1",
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      notas: "Lanzamiento",
    });
    expect(ok.ok).toBe(true);
    const badDate = parseStepData(GENERAL_STEP, { name: "X", startDate: "01/10/2026" });
    expect(badDate.ok).toBe(false);
  });
});

describe("validación derivada de los campos", () => {
  const field = (f: Partial<ProjectFieldDef> & { key: string; label: string }): ProjectFieldDef => ({
    type: "text",
    ...f,
  });
  const step = (fields: ProjectFieldDef[]): ProjectStepDef => ({
    key: "x",
    label: "X",
    kind: "data",
    fields,
  });

  it("texto: obligatorio no acepta vacío y el opcional sí", () => {
    const required = step([field({ key: "a", label: "A", required: true })]);
    expect(parseStepData(required, { a: "" }).ok).toBe(false);
    expect(parseStepData(required, { a: "hola" }).ok).toBe(true);
    const optional = step([field({ key: "a", label: "A" })]);
    expect(parseStepData(optional, {}).ok).toBe(true);
    expect(parseStepData(optional, { a: null }).ok).toBe(true);
  });

  it("número: vacío no se convierte en 0 cuando es opcional", () => {
    const optional = step([field({ key: "n", label: "N", type: "number" })]);
    const empty = parseStepData(optional, { n: "" });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.data.n).toBeNull();
    const required = step([field({ key: "n", label: "N", type: "number", required: true })]);
    expect(parseStepData(required, { n: "" }).ok).toBe(false);
    expect(parseStepData(required, { n: "42" }).ok).toBe(true);
  });

  it("moneda y número respetan min/max", () => {
    const s = step([field({ key: "p", label: "P", type: "currency", required: true, min: 0 })]);
    expect(parseStepData(s, { p: -1 }).ok).toBe(false);
    expect(parseStepData(s, { p: 1500 }).ok).toBe(true);
    const bounded = step([field({ key: "d", label: "D", type: "number", min: 1, max: 30 })]);
    expect(parseStepData(bounded, { d: 0 }).ok).toBe(false);
    expect(parseStepData(bounded, { d: 31 }).ok).toBe(false);
    expect(parseStepData(bounded, { d: 15 }).ok).toBe(true);
  });

  it("select solo acepta las opciones declaradas", () => {
    const s = step([
      field({
        key: "o",
        label: "O",
        type: "select",
        required: true,
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    ]);
    expect(parseStepData(s, { o: "a" }).ok).toBe(true);
    expect(parseStepData(s, { o: "z" }).ok).toBe(false);
    expect(parseStepData(s, {}).ok).toBe(false);
  });

  it("multiselect exige al menos una opción cuando es obligatorio", () => {
    const s = step([
      field({
        key: "m",
        label: "M",
        type: "multiselect",
        required: true,
        options: [
          { value: "x", label: "X" },
          { value: "y", label: "Y" },
        ],
      }),
    ]);
    expect(parseStepData(s, { m: [] }).ok).toBe(false);
    expect(parseStepData(s, { m: ["x"] }).ok).toBe(true);
    expect(parseStepData(s, { m: ["z"] }).ok).toBe(false);
  });

  it("rechaza campos desconocidos (schema estricto)", () => {
    const s = step([field({ key: "a", label: "A" })]);
    expect(parseStepData(s, { a: "1", intruso: "no" }).ok).toBe(false);
  });

  it("stepDataDefaults tipa cada campo según su tipo", () => {
    const s = step([
      field({ key: "t", label: "T" }),
      field({ key: "n", label: "N", type: "number" }),
      field({ key: "m", label: "M", type: "multiselect" }),
      field({ key: "c", label: "C", type: "checkbox" }),
    ]);
    expect(stepDataDefaults(s)).toEqual({ t: null, n: null, m: [], c: false });
  });

  it("formatFieldValue traduce opciones, moneda y checkboxes", () => {
    const select: ProjectFieldDef = {
      key: "s",
      label: "S",
      type: "select",
      options: [{ value: "mensual", label: "Mensual" }],
    };
    expect(formatFieldValue(select, "mensual")).toBe("Mensual");
    expect(formatFieldValue(select, "otro")).toBe("otro");
    const multi: ProjectFieldDef = {
      key: "m",
      label: "M",
      type: "multiselect",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    };
    expect(formatFieldValue(multi, ["a", "b"])).toBe("A, B");
    expect(formatFieldValue({ key: "c", label: "C", type: "checkbox" }, true)).toBe("Sí");
    expect(formatFieldValue({ key: "c", label: "C", type: "checkbox" }, false)).toBe("No");
    expect(formatFieldValue({ key: "p", label: "P", type: "currency" }, 1500)).toContain("1,500");
    expect(formatFieldValue({ key: "t", label: "T", type: "text" }, "")).toBe("");
    expect(formatFieldValue({ key: "t", label: "T", type: "text" }, null)).toBe("");
  });
});

describe("estados de workflow", () => {
  it("los 6 estados tienen etiqueta y variante de badge", () => {
    expect(PROJECT_STATUSES).toHaveLength(6);
    for (const status of PROJECT_STATUSES) {
      expect(PROJECT_STATUS_LABELS[status]).toBeTruthy();
      expect(PROJECT_STATUS_BADGE[status]).toBeTruthy();
    }
  });

  it("statusToEstado deriva el estado legado para el dashboard", () => {
    expect(statusToEstado("completado")).toBe("cerrado");
    expect(statusToEstado("cancelado")).toBe("cerrado");
    expect(statusToEstado("borrador")).toBe("activo");
    expect(statusToEstado("planeacion")).toBe("activo");
    expect(statusToEstado("en_proceso")).toBe("activo");
    expect(statusToEstado("en_revision")).toBe("activo");
  });
});

describe("migración 0020: idempotente y registrada", () => {
  it("ALTER TABLE usa IF NOT EXISTS", () => {
    expect(SQL_0020).toMatch(/ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "project_type"/);
    expect(SQL_0020).toMatch(/ADD COLUMN IF NOT EXISTS "status"/);
    expect(SQL_0020).toMatch(/ADD COLUMN IF NOT EXISTS "start_date"/);
    expect(SQL_0020).toMatch(/ADD COLUMN IF NOT EXISTS "end_date"/);
  });

  it("CREATE TABLE / INDEX usan IF NOT EXISTS", () => {
    expect(SQL_0020).toMatch(/CREATE TABLE IF NOT EXISTS "project_step"/);
    expect(SQL_0020).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "project_step_project_key_uq"/);
    expect(SQL_0020).toMatch(/CREATE INDEX IF NOT EXISTS "project_step_org_idx"/);
    expect(SQL_0020).toMatch(/CREATE INDEX IF NOT EXISTS "project_step_project_idx"/);
  });

  it("la tabla es multi-tenant con cascada sobre proyecto", () => {
    expect(SQL_0020).toContain('"organization_id" varchar(255) NOT NULL');
    expect(SQL_0020).toContain('REFERENCES "project"("id") ON DELETE cascade');
    expect(SQL_0020).toContain("DEFAULT '{}'");
  });

  it("el backfill no degrada proyectos existentes", () => {
    expect(SQL_0020).toContain("WHEN \"estado\" = 'cerrado' THEN 'completado'");
    expect(SQL_0020).toContain('WHERE "status" = \'borrador\'');
  });

  it("el journal registra 0020 como idx 20", () => {
    const entry = JOURNAL.entries.find((e) => e.tag === "0020_project_workflow");
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(20);
    const idxs = JOURNAL.entries.map((e) => e.idx);
    expect(new Set(idxs).size).toBe(idxs.length);
  });
});

describe("schema: tablas nuevas", () => {
  it("expone projectStep con columnas del expediente", async () => {
    const { getTableColumns } = await import("drizzle-orm");
    const { projectStep, project } = await import("@/lib/db/schema");
    const stepCols = Object.keys(getTableColumns(projectStep));
    for (const col of [
      "id",
      "organizationId",
      "projectId",
      "stepKey",
      "position",
      "status",
      "data",
      "completedAt",
    ]) {
      expect(stepCols).toContain(col);
    }
    const projectCols = Object.keys(getTableColumns(project));
    for (const col of ["projectType", "status", "startDate", "endDate"]) {
      expect(projectCols).toContain(col);
    }
  });
});
