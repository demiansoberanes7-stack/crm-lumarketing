import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/automations/followup
 * Manually trigger a follow-up workflow for a given conversation.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = (await req.json()) as {
    conversationId?: string;
    delayHours?: number;
  };

  if (!body.conversationId) {
    return NextResponse.json({ error: "conversationId requerido" }, { status: 400 });
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, body.conversationId))
    .limit(1);

  const conv = rows[0];
  if (!conv || conv.organizationId !== session.organizationId) {
    return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
  }

  const delayHours = body.delayHours ?? 72;

  try {
    const { getTemporalClient } = await import("@/server/temporal/client");
    const client = await getTemporalClient();
    const workflowId = `followup-manual-${body.conversationId}-${Date.now()}`;
    await client.workflow.start("followUpWorkflow", {
      args: [body.conversationId, session.organizationId, delayHours],
      taskQueue: "crm-followups",
      workflowId,
    });
    return NextResponse.json({ ok: true, workflowId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If Temporal is not running, return a soft error (non-breaking)
    return NextResponse.json(
      { ok: false, error: "Temporal no disponible: " + msg },
      { status: 503 }
    );
  }
});
