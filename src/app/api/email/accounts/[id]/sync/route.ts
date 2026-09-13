import { apiError, withAuth } from "@/lib/api";
import { syncInbox } from "@/server/email/service";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

/** POST — sincronizar inbox IMAP */
export const POST = withAuth(async (session, _req, { params }) => {
  const { id } = await params;

  try {
    const synced = await syncInbox(session.organizationId, id);
    return Response.json({ ok: true, synced });
  } catch (err) {
    return apiError(500, "sync_failed", String(err));
  }
});
