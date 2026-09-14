import { withAuth } from "@/lib/api";
import { listProjectMembers } from "@/server/projects/members";

export const dynamic = "force-dynamic";
export const GET = withAuth(async (session) => Response.json({ members: await listProjectMembers(session.organizationId) }));
