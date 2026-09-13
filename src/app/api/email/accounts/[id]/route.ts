import { withAuth } from "@/lib/api";
import { deleteEmailAccount } from "@/server/email/service";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

/** DELETE — eliminar cuenta de email */
export const DELETE = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  await deleteEmailAccount(session.organizationId, id);
  return Response.json({ ok: true });
});
