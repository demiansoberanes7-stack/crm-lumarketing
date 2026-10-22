import { z } from "zod";
import { EMAIL_AUDIENCE_LIMIT } from "@/server/email-campaigns/recipients";

const emailRecipientSchema = z.object({
  email: z.string().trim().min(3).max(320),
  name: z.string().trim().max(255).optional().nullable(),
  // Una lista manual no son contactos del CRM: aceptar un id del cliente
  // permitiría apuntar a la ficha de otro negocio. Solo se admite null.
  contactId: z.literal(null).optional(),
}).strict();

export const emailAudienceSchema = z
  .object({
    kind: z.enum(["contacts", "mailbox", "list"]),
    /** Direcciones ya extraídas (carga de archivo o vista previa). */
    recipients: z.array(emailRecipientSchema).max(EMAIL_AUDIENCE_LIMIT).optional(),
    /** Texto pegado a mano o CSV (se parsea en el servidor). */
    text: z.string().max(200_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "list" && !value.recipients?.length && !value.text?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["text"],
        message: "Pega al menos un correo o carga un archivo",
      });
    }
  });

export const createEmailCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    senderAccountId: z.string().trim().min(1).max(255),
    // Un CR/LF en el asunto añade cabeceras (`Bcc:`) al correo entregado.
    subject: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .refine((value) => !/[\r\n\u0000]/.test(value), {
        message: "El asunto no puede contener saltos de línea",
      }),
    bodyText: z.string().trim().min(1).max(50_000),
    audience: emailAudienceSchema,
  })
  .strict();

export const previewEmailAudienceSchema = emailAudienceSchema;

export type CreateEmailCampaignInput = z.infer<typeof createEmailCampaignSchema>;
