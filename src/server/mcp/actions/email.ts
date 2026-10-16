import { z } from "zod";
import { recordDiagnostic } from "@/server/diagnostics/logger";
import { safeDiagnosticText } from "@/server/diagnostics/redact";
import { listEmailAccounts, sendEmail } from "@/server/email/service";
import { defineAction } from "@/server/mcp/registry";

/** Forma cruda reutilizable por la herramienta nativa `send_email`. */
export const emailSendShape = {
  accountId: z.string().min(1).max(255),
  to: z.string().email(),
  subject: z.string().min(1).max(500),
  text: z.string().max(20000).optional(),
  html: z.string().max(100000).optional(),
  inReplyTo: z.string().max(500).optional(),
};

const emailSend = z.object(emailSendShape);

const emailAccounts = z.object({});

export const emailActions = [
  defineAction({
    name: "email.accounts",
    domain: "email",
    kind: "read",
    scope: "crm.email.read",
    title: "Listar cuentas de correo",
    description:
      "Lista las cuentas de correo conectadas (id, etiqueta, dirección y estado). No expone credenciales: sirve para elegir el accountId al enviar.",
    input: emailAccounts,
    handler: async (principal) => {
      const accounts = await listEmailAccounts(principal.organizationId);
      return {
        text: `Se encontraron ${accounts.length} cuenta(s) de correo.`,
        structuredContent: {
          count: accounts.length,
          accounts: accounts.map((account) => ({
            id: account.id,
            label: account.label,
            email: account.email,
            enabled: account.enabled,
          })),
        },
      };
    },
  }),

  defineAction({
    name: "email.send",
    domain: "email",
    kind: "send",
    scope: "crm.email.send",
    title: "Enviar correo",
    description:
      "Envía un correo desde una cuenta conectada del CRM (SMTP propio) y lo registra en la bandeja. Usa email.accounts para obtener el accountId.",
    destructive: true,
    input: emailSend,
    handler: async (principal, input) => {
      try {
        const messageId = await sendEmail(principal.organizationId, input.accountId, {
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
          inReplyTo: input.inReplyTo,
        });
        return {
          text: `Correo enviado a ${input.to}.`,
          structuredContent: { messageId, to: input.to },
        };
      } catch (err) {
        await recordDiagnostic({
          organizationId: principal.organizationId,
          source: "email",
          code: "send_failed",
          error: err,
          metadata: { operation: "send", provider: "smtp", accountId: input.accountId },
        });
        const detail = err instanceof Error ? safeDiagnosticText(err.message, 500) : "Error SMTP";
        throw new Error(`No se pudo enviar el correo: ${detail}`);
      }
    },
  }),
];
