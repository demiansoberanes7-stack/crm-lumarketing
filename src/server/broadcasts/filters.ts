import { z } from "zod";
import { MEDIUM_VALUES, SOCIAL_NETWORKS } from "@/lib/contact-medium";

/**
 * Un canal de chat por campaña (WhatsApp / Instagram / Messenger / TikTok).
 * Email, comentarios y reseñas quedan FUERA: no son canales de envío libre.
 */
export const BROADCAST_CHANNELS = [
  "whatsapp",
  "instagram",
  "messenger",
  "tiktok",
] as const;

export type BroadcastChannel = (typeof BROADCAST_CHANNELS)[number];

export const broadcastChannelSchema = z.enum(BROADCAST_CHANNELS);

export const broadcastFiltersSchema = z.object({
  stageId: z.string().trim().min(1).max(255).optional(),
  medium: z.enum(MEDIUM_VALUES).optional(),
  mediumDetail: z.enum(SOCIAL_NETWORKS).optional(),
  noteText: z.string().trim().min(1).max(160).optional(),
  noteDays: z.number().int().min(1).max(365).optional(),
  /** IDs de contactos específicos (programación individual desde Contactos). */
  contactIds: z.array(z.string().trim().min(1).max(255)).min(1).max(500).optional(),
}).strict();

/**
 * Vista previa del segmento: mismos filtros + el canal de la campaña, porque
 * la elegibilidad (conversación y ventana) depende del canal elegido.
 */
export const previewBroadcastSchema = broadcastFiltersSchema.extend({
  channel: broadcastChannelSchema.default("whatsapp"),
}).strict();

export const createBroadcastSchema = z.object({
  name: z.string().trim().min(1).max(160),
  messageText: z.string().trim().min(1).max(4000),
  channel: broadcastChannelSchema.default("whatsapp"),
  filters: broadcastFiltersSchema,
  /**
   * Fecha/hora ISO en que debe salir. Si es null o pasada, sale ya.
   * El worker solo procesa `scheduled_at <= now`, así que una fecha futura
   * retiene la cola hasta que llegue el momento.
   */
  scheduledAt: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable()
    .refine((v) => {
      if (!v) return true;
      const d = new Date(v);
      return !Number.isNaN(d.getTime()) && d.getTime() > Date.now() - 60_000;
    }, "La fecha de programación debe ser en el futuro"),
}).strict();

export type BroadcastFiltersInput = z.infer<typeof broadcastFiltersSchema>;
