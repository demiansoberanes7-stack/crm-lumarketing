import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { parseBody } from "@/lib/api";
import {
  runInboundWebhookWorkerOnce,
  setInboundWebhookWorkerPausedForTest,
} from "@/server/webhooks/inbound-queue";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["pause", "restart"]) });

/** Test harness only: simulate worker interruption/restart after provider ACK. */
export async function POST(request: Request) {
  const denied = mockGuard();
  if (denied) return denied;
  const body = await parseBody(request, bodySchema);
  if (!body.ok) return body.response;

  if (body.data.action === "pause") {
    setInboundWebhookWorkerPausedForTest(true);
    return Response.json({ paused: true });
  }

  setInboundWebhookWorkerPausedForTest(false);
  const result = await runInboundWebhookWorkerOnce();
  return Response.json({ restarted: true, result });
}
