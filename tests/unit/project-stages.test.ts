import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTaskSchema,
  DEFAULT_PROJECT_STAGES,
  taskStateSchema,
  updateTaskSchema,
} from "@/lib/project-contract";

/**
 * Tests para la migración 0003 (project_stage) y el contract de proyectos.
 *
 * Verifica:
 *  - El SQL es idempotente (IF NOT EXISTS / IF EXISTS / ON CONFLICT)
 *  - El catálogo de etapas por defecto coincide con el seed del SQL
 *  - Los schemas Zod rechazan datos inválidos y aceptan válidos
 *  - Los estados de tarea están restringidos a los 3 valores
 */

const ROOT = process.cwd();
const DRIZZLE_DIR = path.join(ROOT, "drizzle");
const SQL_0003 = readFileSync(path.join(DRIZZLE_DIR, "0003_project_stages.sql"), "utf8");

describe("migración 0003: SQL idempotente", () => {
  it("CREATE TABLE usa IF NOT EXISTS", () => {
    expect(SQL_0003).toMatch(/CREATE TABLE IF NOT EXISTS "project_stage"/);
  });

  it("DROP CONSTRAINT usa IF EXISTS en las 3 FKs", () => {
    const drops = SQL_0003.match(/DROP CONSTRAINT IF EXISTS/g);
    expect(drops?.length).toBeGreaterThanOrEqual(3);
  });

  it("INSERT usa ON CONFLICT DO NOTHING", () => {
    expect(SQL_0003).toContain("ON CONFLICT (id) DO NOTHING");
  });

  it("Las 3 ADD CONSTRAINT usan DO $$ BEGIN ... EXCEPTION", () => {
    const doBlocks = SQL_0003.match(/DO \$\$ BEGIN/g);
    expect(doBlocks?.length).toBeGreaterThanOrEqual(3);
  });

  it("CREATE UNIQUE INDEX usa IF NOT EXISTS", () => {
    expect(SQL_0003).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "project_stage_org_position_uq"/
    );
  });

  it("seed incluye las 7 etapas del catálogo", () => {
    for (const name of DEFAULT_PROJECT_STAGES) {
      expect(SQL_0003).toContain(`'${name}'`);
    }
  });

  it("normaliza estados de tarea a los 3 valores permitidos", () => {
    expect(SQL_0003).toContain("'terminado'");
    expect(SQL_0003).toContain("'pendiente'");
    expect(SQL_0003).toContain("'no_empezado'");
  });
});

describe("migración 0003: journal y snapshot", () => {
  it("el journal incluye la entrada 0003", () => {
    const journal = JSON.parse(
      readFileSync(path.join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8")
    );
    const entry = journal.entries.find(
      (e: { version: string; tag: string }) => e.tag.startsWith("0003")
    );
    expect(entry).toBeDefined();
    expect(entry.version).toBe("7");
  });

  it("el snapshot 0003 existe y referencia a project_stage", () => {
    const snap = JSON.parse(
      readFileSync(path.join(DRIZZLE_DIR, "meta", "0003_snapshot.json"), "utf8")
    );
    expect(snap.id).toBeDefined();
    expect(snap.version).toBe("7");
    expect(snap.dialect).toBe("postgresql");
  });
});

describe("project-contract: taskStateSchema", () => {
  it("acepta los 3 estados válidos", () => {
    expect(taskStateSchema.safeParse("no_empezado").success).toBe(true);
    expect(taskStateSchema.safeParse("pendiente").success).toBe(true);
    expect(taskStateSchema.safeParse("terminado").success).toBe(true);
  });

  it("rechaza estados inválidos", () => {
    expect(taskStateSchema.safeParse("completada").success).toBe(false);
    expect(taskStateSchema.safeParse("completado").success).toBe(false);
    expect(taskStateSchema.safeParse("en_progreso").success).toBe(false);
    expect(taskStateSchema.safeParse("").success).toBe(false);
  });
});

describe("project-contract: createTaskSchema", () => {
  it("acepta tarea mínima (solo título)", () => {
    const r = createTaskSchema.safeParse({ title: "Diseñar logo" });
    expect(r.success).toBe(true);
  });

  it("acepta tarea completa", () => {
    const r = createTaskSchema.safeParse({
      title: "Brief",
      description: "Recopilar requerimientos",
      assigneeId: "user_abc",
      prioridad: "alta",
      dueDate: "2026-10-01T00:00:00.000Z",
      estado: "pendiente",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza título vacío", () => {
    const r = createTaskSchema.safeParse({ title: "" });
    expect(r.success).toBe(false);
  });

  it("rechaza campos desconocidos (strict)", () => {
    const r = createTaskSchema.safeParse({ title: "X", foo: "bar" });
    expect(r.success).toBe(false);
  });

  it("rechaza prioridad inválida", () => {
    const r = createTaskSchema.safeParse({ title: "X", prioridad: "urgente" });
    expect(r.success).toBe(false);
  });

  it("acepta assigneeId null (sin responsable)", () => {
    const r = createTaskSchema.safeParse({ title: "X", assigneeId: null });
    expect(r.success).toBe(true);
  });
});

describe("project-contract: updateTaskSchema", () => {
  it("rechaza objeto vacío", () => {
    const r = updateTaskSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("acepta cambio parcial de estado", () => {
    const r = updateTaskSchema.safeParse({ estado: "terminado" });
    expect(r.success).toBe(true);
  });

  it("acepta cambio parcial de prioridad", () => {
    const r = updateTaskSchema.safeParse({ prioridad: "baja" });
    expect(r.success).toBe(true);
  });

  it("acepta cambio de responsable", () => {
    const r = updateTaskSchema.safeParse({ assigneeId: "user_xyz" });
    expect(r.success).toBe(true);
  });
});

describe("project-contract: DEFAULT_PROJECT_STAGES", () => {
  it("tiene exactamente 7 etapas", () => {
    expect(DEFAULT_PROJECT_STAGES).toHaveLength(7);
  });

  it("todas son strings no vacíos", () => {
    for (const s of DEFAULT_PROJECT_STAGES) {
      expect(typeof s).toBe("string");
      expect(s.trim().length).toBeGreaterThan(0);
    }
  });

  it("no hay duplicados", () => {
    expect(new Set(DEFAULT_PROJECT_STAGES).size).toBe(DEFAULT_PROJECT_STAGES.length);
  });

  it("empieza con Activación y termina con Renovación", () => {
    expect(DEFAULT_PROJECT_STAGES[0]).toBe("Activación");
    expect(DEFAULT_PROJECT_STAGES[6]).toBe("Renovación");
  });
});
