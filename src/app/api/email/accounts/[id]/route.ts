import { withOwner, parseBody, apiError } from "@/lib/api";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { encryptSecret } from "@/lib/crypto";
import { deleteEmailAccount } from "@/server/email/service";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

/** DELETE — eliminar cuenta de email */
export const DELETE = withOwner(async (session, _req, { params }) => {
  const { id } = await params;
  await deleteEmailAccount(session.organizationId, id);
  return Response.json({ ok: true });
});

/**
 * `enabled` es la única que puede venir sola: la fila de Ajustes → Email tiene
 * su botón de Activar/Desactivar y no tiene sentido que reenvíe la contraseña
 * para apagar una cuenta. Las demás son el formulario de edición y van juntas.
 */
const patchSchema = z
  .object({
    label: z.string().max(255).optional(),
    email: z.string().email().optional(),
    imapHost: z.string().min(1).optional(),
    imapPort: z.number().int().min(1).max(65535).optional(),
    smtpHost: z.string().min(1).optional(),
    smtpPort: z.number().int().min(1).max(65535).optional(),
    username: z.string().min(1).optional(),
    password: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.enabled !== undefined ||
      (d.email && d.imapHost && d.imapPort && d.smtpHost && d.smtpPort && d.username),
    "Faltan los datos de la cuenta (o manda solo `enabled`)"
  );

export const PATCH = withOwner(async (session, req: Request, { params }: _Params) => {
  const { id } = await params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const input = body.data;
  const secret = input.password ? encryptSecret(input.password) : null;
  const [account] = await getDb().update(schema.emailAccount).set({
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.email
      ? {
          label: input.label ?? input.email,
          emailAddress: input.email,
          imapHost: input.imapHost!,
          imapPort: input.imapPort!,
          imapSecure: input.imapPort === 993,
          smtpHost: input.smtpHost!,
          smtpPort: input.smtpPort!,
          smtpSecure: input.smtpPort === 465,
          smtpUser: input.username!,
          imapUser: input.username!,
        }
      : {}),
    ...(secret ? { smtpPassCipher: secret.cipher, smtpPassIv: secret.iv, smtpPassTag: secret.tag, imapPassCipher: secret.cipher, imapPassIv: secret.iv, imapPassTag: secret.tag } : {}),
    updatedAt: new Date(),
  }).where(scoped(schema.emailAccount.organizationId, session.organizationId, eq(schema.emailAccount.id, id))).returning({ id: schema.emailAccount.id });
  if (!account) return apiError(404, "not_found", "Cuenta no encontrada");
  return Response.json({ ok: true });
});
