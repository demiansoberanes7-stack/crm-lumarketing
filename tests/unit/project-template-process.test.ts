import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Procesos de proyecto por negocio (migración 0079).
 *
 * Lo que no puede romperse: las claves derivadas del nombre, la validación del
 * editor, que los tres procesos base se siembren idénticos al registro
 * estático, que un proyecto con proceso personalizado no dependa del catálogo
 * de código y que el borrado/edición nunca alcance a proyectos ya creados
 * (ellos guardan su propia definición congelada).
 */

const h = vi.hoisted(() => {
  const state = { selects: [] as unknown[][] };
  function chain(rows: unknown[]) {
    const proxy: unknown = new Proxy(Promise.resolve(rows), {
      get(target, prop) {
        if (prop === "then" || prop === "catch" || prop === "finally") {
          const fn = Reflect.get(target, prop);
          return typeof fn === "function" ? fn.bind(target) : fn;
        }
        if (typeof prop === "symbol") return Reflect.get(target, prop);
        return () => proxy;
      },
    });
    return proxy;
  }
  return {
    state,
    db: {
      select: () => chain(state.selects.shift() ?? []),
      insert: () => chain([]),
      update: () => chain([]),
    },
  };
});

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: () => h.db,
}));

import {
  GENERAL_STEP,
  PROJECT_TASK_TEMPLATES,
  PROJECT_TYPES,
  projectTypeLabel,
} from "@/lib/project-types";
import {
  DEFAULT_PROJECT_TEMPLATE_SEEDS,
  frozenStepDefinition,
  projectTemplateInputSchema,
  resolveStepDefinition,
  slugifyProjectKey,
  uniqueProjectKey,
  type ProjectTemplateStep,
} from "@/lib/project-templates";
import { pickDefaultTemplate, resolveProjectTemplate, templateStepDefs } from "@/server/projects/templates";

function step(key: string, label: string): ProjectTemplateStep {
  return { key, label, description: null, fields: [{ key: "campo", label: "Campo", type: "text" }] };
}

describe("claves de proceso", () => {
  it("normaliza el nombre visible sin acentos ni símbolos", () => {
    expect(slugifyProjectKey("Instalación de Cámaras!")).toBe("instalacion_de_camaras");
    expect(slugifyProjectKey("24/7 Soporte")).toBe("p_24_7_soporte");
    expect(slugifyProjectKey("   ")).toBe("proceso");
  });

  it("nunca reutiliza una clave tomada ni la general reservada", () => {
    const taken = new Set(["mantenimiento", "general"]);
    expect(uniqueProjectKey("Mantenimiento", taken)).toBe("mantenimiento_2");
    expect(uniqueProjectKey("General", taken)).toBe("general_2");
    expect(uniqueProjectKey("Diseño Web", taken)).toBe("diseno_web");
  });
});

describe("validación del editor de procesos", () => {
  const valid = {
    label: "Instalación de cámaras",
    description: "CCTV llave en mano",
    icon: "settings" as const,
    steps: [step("sitio", "Visita al sitio"), step("entrega", "Entrega")],
    tasks: [{ title: "Agendar la visita" }],
  };

  it("acepta un proceso personalizado bien formado", () => {
    expect(projectTemplateInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rechaza pasos repetidos, sin pasos, listas sin opciones y campos extra", () => {
    expect(
      projectTemplateInputSchema.safeParse({
        ...valid,
        steps: [step("sitio", "A"), step("sitio", "B")],
      }).success
    ).toBe(false);
    expect(projectTemplateInputSchema.safeParse({ ...valid, steps: [] }).success).toBe(false);
    expect(
      projectTemplateInputSchema.safeParse({
        ...valid,
        steps: [
          {
            key: "alcance",
            label: "Alcance",
            fields: [{ key: "tipo", label: "Tipo", type: "select", options: [] }],
          },
        ],
      }).success
    ).toBe(false);
    expect(
      projectTemplateInputSchema.safeParse({ ...valid, isDefault: true }).success
    ).toBe(false);
  });

  it("respeta los límites de la plantilla", () => {
    const many = Array.from({ length: 21 }, (_, i) => step(`paso_${i}`, `Paso ${i}`));
    expect(projectTemplateInputSchema.safeParse({ ...valid, steps: many }).success).toBe(false);
  });
});

describe("siembra de los tres procesos base", () => {
  it("refleja el registro estático sin perder seguimientos", () => {
    expect(DEFAULT_PROJECT_TEMPLATE_SEEDS.map((s) => s.key)).toEqual(
      PROJECT_TYPES.map((t) => t.key)
    );
    for (const seed of DEFAULT_PROJECT_TEMPLATE_SEEDS) {
      expect(seed.steps.length).toBeGreaterThanOrEqual(4);
      expect(seed.steps.some((s) => s.key === GENERAL_STEP.key)).toBe(false);
      expect(seed.tasks.length).toBe((PROJECT_TASK_TEMPLATES[seed.key] ?? []).length);
      expect(seed.icon).toBeTruthy();
    }
  });

  it("el stepper siempre empieza por el paso general", () => {
    const defs = templateStepDefs({
      steps: [step("general", "Paso duplicado del usuario"), step("sitio", "Visita")],
    });
    expect(defs.map((d) => d.key)).toEqual([GENERAL_STEP.key, "sitio"]);
    expect(defs[0]?.kind).toBe("project");
    expect(defs[1]?.kind).toBe("data");
  });
});

describe("definiciones congeladas del proyecto", () => {
  it("la instantánea sobrevive al renombrado del proceso", () => {
    const frozen = frozenStepDefinition({
      key: "sitio",
      label: "Visita al sitio",
      description: "Medidas y fotos",
      kind: "data",
      fields: [{ key: "m2", label: "Metros cuadrados", type: "number" }],
    });
    const resolved = resolveStepDefinition("sitio", frozen);
    expect(resolved.label).toBe("Visita al sitio");
    expect(resolved.fields[0]?.label).toBe("Metros cuadrados");

    // Aunque el proceso cambie después, el proyecto congelado sigue igual.
    const edited = resolveStepDefinition("sitio", frozen, {
      key: "sitio",
      label: "Etiqueta nueva del catálogo",
      kind: "data",
      fields: [],
    });
    expect(edited.label).toBe("Visita al sitio");
  });

  it("sin instantánea cae al catálogo estático y si no, a un paso vacío", () => {
    const fallback = { key: "sitio", label: "Estático", kind: "data" as const, fields: [] };
    expect(resolveStepDefinition("sitio", null, fallback).label).toBe("Estático");
    expect(resolveStepDefinition("sitio", undefined).label).toBe("sitio");
  });

  it("la etiqueta del proyecto prioriza la congelada al nacer", () => {
    expect(
      projectTypeLabel({ projectType: "maintenance", projectTypeLabel: "CCTV llave en mano" })
    ).toBe("CCTV llave en mano");
    expect(projectTypeLabel({ projectType: "maintenance" })).toBe("Mantenimiento");
    expect(projectTypeLabel({ projectType: "proceso_borrado" })).toBe("proceso_borrado");
  });
});

describe("resolución del proceso al crear un proyecto", () => {
  beforeEach(() => {
    h.state.selects.length = 0;
  });

  const rows = [
    {
      id: "pt_1", key: "mantenimiento", label: "Mantenimiento", description: null,
      icon: "hammer", position: 0, isSystem: false, isDefault: true, deletedAt: null,
      steps: [step("sitio", "Visita")], tasks: [],
    },
    {
      id: "pt_2", key: "camaras", label: "CCTV", description: null,
      icon: "settings", position: 1, isSystem: false, isDefault: false, deletedAt: null,
      steps: [step("sitio", "Visita"), step("entrega", "Entrega")], tasks: [{ title: "Llamar" }],
    },
  ];

  it("usa la clave pedida y su etiqueta, no la del catálogo", async () => {
    h.state.selects.push([{ id: "pt_1" }], rows);
    const template = await resolveProjectTemplate("org_1", "camaras");
    expect(template.label).toBe("CCTV");
    expect(template.steps).toHaveLength(2);
  });

  it("el predeterminado manda y sin predeterminado gana el primero", () => {
    expect(pickDefaultTemplate(rows)?.key).toBe("mantenimiento");
    expect(pickDefaultTemplate(rows.map((r) => ({ ...r, isDefault: false })))?.key).toBe(
      "mantenimiento"
    );
    expect(pickDefaultTemplate([])).toBeNull();
  });

  it("sin clave usa el predeterminado y con clave desconocida falla en 422", async () => {
    h.state.selects.push([{ id: "pt_1" }], rows);
    expect((await resolveProjectTemplate("org_1")).key).toBe("mantenimiento");

    h.state.selects.push([{ id: "pt_1" }], rows);
    await expect(resolveProjectTemplate("org_1", "proceso_borrado")).rejects.toMatchObject({
      status: 422,
    });
  });
});
