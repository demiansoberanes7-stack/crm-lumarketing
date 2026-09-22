import { withAuth, parseBody, apiError } from "@/lib/api";
import { caltodoSettingsFields, caltodoSettingsSchema, DEFAULT_TODO_SETTINGS } from "@/lib/caltodo";
import { getCalTodoSettings, upsertCalTodoSettings } from "@/server/caltodo/store";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const settings = await getCalTodoSettings(session.userId, session.organizationId);
  return Response.json({ settings });
});

export const PATCH = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, caltodoSettingsFields.partial());
  if (!body.ok) return body.response;
  const existing = await getCalTodoSettings(session.userId, session.organizationId);
  const parsed = caltodoSettingsSchema.safeParse({ ...DEFAULT_TODO_SETTINGS, ...existing, ...body.data });
  if (!parsed.success) return apiError(422, "invalid_settings", parsed.error.issues.map((i) => i.message).join("; "));
  await upsertCalTodoSettings(session.userId, session.organizationId, parsed.data);
  return Response.json({ settings: await getCalTodoSettings(session.userId, session.organizationId) });
});
