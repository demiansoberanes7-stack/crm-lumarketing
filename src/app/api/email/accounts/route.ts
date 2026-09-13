import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { listEmailAccounts, createEmailAccount } from "@/server/email/service";

export const dynamic = "force-dynamic";

/** GET — listar cuentas de email */
export const GET = withAuth(async (session) => {
  const accounts = await listEmailAccounts(session.organizationId);
  return Response.json({ accounts });
});

const postSchema = z.object({
  label: z.string().optional(),
  email: z.string().email(),
  imapHost: z.string().min(1),
  imapPort: z.number().int(),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int(),
  username: z.string().min(1),
  password: z.string().min(1),
});

/** POST — crear cuenta de email */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  const id = await createEmailAccount(session.organizationId, body.data);
  return Response.json({ ok: true, accountId: id }, { status: 201 });
});
