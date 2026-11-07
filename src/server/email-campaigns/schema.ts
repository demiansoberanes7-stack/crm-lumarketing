import { z } from "zod";
import { EMAIL_TEMPLATE_HTML_MAX } from "@/lib/email-format";
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

// Un CR/LF en el asunto añade cabeceras (`Bcc:`) al correo entregado.
const emailSubjectSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((value) => !/[\r\n\u0000]/.test(value), {
    message: "El asunto no puede contener saltos de línea",
  });

export const createEmailCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    senderAccountId: z.string().trim().min(1).max(255),
    subject: emailSubjectSchema,
    /** Versión de texto; si falta, se deriva del HTML de la plantilla. */
    bodyText: z.string().trim().max(50_000).optional(),
    bodyHtml: z.string().trim().max(EMAIL_TEMPLATE_HTML_MAX).optional(),
    audience: emailAudienceSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.bodyText && !value.bodyHtml) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bodyText"],
        message: "Escribe el mensaje o elige una plantilla HTML",
      });
    }
  });

export const createEmailTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    subject: emailSubjectSchema,
    html: z.string().trim().min(1).max(EMAIL_TEMPLATE_HTML_MAX),
  })
  .strict();

export const previewEmailAudienceSchema = emailAudienceSchema;

export type CreateEmailCampaignInput = z.infer<typeof createEmailCampaignSchema>;
export type CreateEmailTemplateInput = z.infer<typeof createEmailTemplateSchema>;
