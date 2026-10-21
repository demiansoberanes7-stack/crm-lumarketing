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
  /**
   * Restringe la audiencia a contactos con opt-in de marketing por WhatsApp.
   * Obligatorio de facto para plantillas MARKETING.
   */
  optInOnly: z.boolean().optional(),
}).strict();

/**
 * Vista previa del segmento: mismos filtros + el canal de la campaña, porque
 * la elegibilidad (conversación y ventana) depende del canal elegido.
 */
export const previewBroadcastSchema = broadcastFiltersSchema.extend({
  channel: broadcastChannelSchema.default("whatsapp"),
  /** Permite reflejar que una plantilla de WhatsApp salta la ventana. */
  templateName: z.string().trim().min(1).max(255).optional(),
}).strict();

export const createBroadcastSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    /** Obligatorio sin plantilla; con plantilla el texto sale del cuerpo aprobado. */
    messageText: z.string().trim().min(1).max(4000).optional(),
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
    /** Plantilla aprobada de WhatsApp (fuera de ventana es la única vía legal). */
    templateName: z.string().trim().min(1).max(255).optional(),
    templateLanguage: z.string().trim().min(1).max(20).optional(),
    /** Valores de {{1}}…{{n}}; admite `{{nombre}}` para personalizar. */
    templateParams: z.array(z.string().max(1024)).max(20).optional(),
    templateCategory: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).optional(),
    /**
     * Enlace público del encabezado multimedia (IMAGE/VIDEO/DOCUMENT). Meta
     * exige https para descargarlo en el momento del envío.
     */
    templateHeaderMediaUrl: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => value.startsWith("https://"), {
        message: "El enlace del encabezado debe empezar por https://",
      })
      .optional(),
    /**
     * Atestación de opt-in para UN envío individual (agenda desde Contactos).
     * En campañas masivas no se acepta: el consentimiento debe estar
     * registrado contacto por contacto.
     */
    optInConfirmed: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasTemplate = Boolean(data.templateName);
    if (!hasTemplate && !data.messageText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messageText"],
        message: "Escribe el mensaje de la campaña o elige una plantilla aprobada",
      });
    }
    if (hasTemplate) {
      if (data.channel !== "whatsapp") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["templateName"],
          message: "Las plantillas solo existen en WhatsApp",
        });
      }
      if (!data.templateLanguage) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["templateLanguage"],
          message: "Falta el idioma de la plantilla",
        });
      }
      if (!data.templateCategory) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["templateCategory"],
          message: "Falta la categoría de la plantilla",
        });
      }
    }
    if (data.optInConfirmed) {
      const contactIds = data.filters.contactIds ?? [];
      if (contactIds.length !== 1 || data.channel !== "whatsapp") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["optInConfirmed"],
          message: "El opt-in del operador solo aplica a un envío individual por WhatsApp",
        });
      }
    }
  });

export type BroadcastFiltersInput = z.infer<typeof broadcastFiltersSchema>;
