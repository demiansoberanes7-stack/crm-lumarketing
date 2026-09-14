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

export const DEFAULT_PROJECT_STAGES = ["Activación", "Diagnóstico", "Calendario de Contenido", "Creación de Contenido", "Campaña", "Reporte de Resultados", "Renovación"];
