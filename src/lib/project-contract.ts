import { z } from "zod";

export const TASK_STATES = { no_empezado: "No empezado", pendiente: "Pendiente", terminado: "Terminado" } as const;
export const taskStateSchema = z.enum(["no_empezado", "pendiente", "terminado"]);
export const taskFields = {
  title: z.string().trim().min(1).max(255),
  description: z.string().max(10000).nullable().optional(),
  assigneeId: z.string().min(1).max(255).nullable().optional(),
  prioridad: z.enum(["alta", "media", "baja"]).nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  estado: taskStateSchema.optional(),
};
export const createTaskSchema = z.object(taskFields).strict();
export const updateTaskSchema = createTaskSchema.partial().refine((v) => Object.keys(v).length > 0, "Indica al menos un cambio");

/** Productos / servicios del expediente (los que imprime el PDF). */
export const itemFields = {
  name: z.string().trim().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  quantity: z.number().int().min(1).max(100000),
  /** Centavos, como en quote_item. */
  unitPrice: z.number().int().min(0),
};
export const createItemSchema = z.object(itemFields).strict();
export const updateItemSchema = createItemSchema.partial().refine((v) => Object.keys(v).length > 0, "Indica al menos un cambio");

export const DEFAULT_PROJECT_STAGES = ["Activación", "Diagnóstico", "Calendario de Entregable", "Creación de Entregable", "Terminación de Entregable", "Reporte de Resultados", "Renovación"];
