import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getBusinessSettings, saveBusinessSettings } from "@/server/business-settings";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const settings = await getBusinessSettings(session.organizationId);
  return Response.json({ settings });
});

const putSchema = z.object({
  companyName: z.string().max(200).optional(),
  rfc: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().max(254).optional(),
  logoUrl: z.string().max(1024).optional(),
  website: z.string().max(254).optional(),
});

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const current = await getBusinessSettings(session.organizationId);
  await saveBusinessSettings(session.organizationId, { ...current, ...body.data });
  return Response.json({ ok: true });
});
