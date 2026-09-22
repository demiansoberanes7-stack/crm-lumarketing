import { withAuth, parseBody } from "@/lib/api";
import { getCalTodoSettings, upsertCalTodoSettings } from "@/server/caltodo/store";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const settings = await getCalTodoSettings(session.userId, session.organizationId);
  return Response.json({ settings });
});

export const PATCH = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, {
    workStartHour: true,
    workEndHour: true,
    timezone: true,
    defaultDuration: true,
  } as never);
  if (!body.ok) return body.response;
  const data = (await req.json()) as Record<string, unknown>;
  await upsertCalTodoSettings(session.userId, session.organizationId, data);
  return Response.json({ ok: true });
});
